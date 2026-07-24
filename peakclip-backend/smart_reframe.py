"""
Smart Reframe: AI-powered horizontal-to-vertical video reframing.

Detects the main subject (face/head/body) and dynamically tracks them with
smooth camera movement, producing professional-quality vertical clips
suitable for TikTok, Reels, Shorts.
"""

import cv2
import numpy as np
import subprocess
import os
import sys
import json
import tempfile


class SubjectTracker:
    """
    Tracks the main subject across frames with EMA smoothing.
    Produces cinematic camera movement by smoothing crop center coordinates.
    """

    def __init__(self, src_w, src_h, alpha=0.25, vertical_anchor=0.33):
        self.src_w = src_w
        self.src_h = src_h
        self.alpha = alpha
        self.vertical_anchor = vertical_anchor

        self.smooth_cx = src_w / 2.0
        self.smooth_cy = src_h * vertical_anchor
        self.smooth_face_ratio = 0.0

        self.face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        self.body_cascade = None
        try:
            self.body_cascade = cv2.CascadeClassifier(
                cv2.data.haarcascades + "haarcascade_fullbody.xml"
            )
        except Exception:
            pass

        self.prev_hist = None
        self.scene_change_threshold = 0.65
        self.frames_since_scene = 0
        self.scene_cooldown = 10

    def detect_scene_change(self, frame):
        small = cv2.resize(frame, (160, 90))
        hist = cv2.calcHist([small], [0], None, [256], [0, 256])
        cv2.normalize(hist, hist)
        if self.prev_hist is not None:
            corr = cv2.compareHist(self.prev_hist, hist, cv2.HISTCMP_CORREL)
            self.prev_hist = hist
            if corr < self.scene_change_threshold and self.frames_since_scene > self.scene_cooldown:
                self.frames_since_scene = 0
                return True
        else:
            self.prev_hist = hist
        self.frames_since_scene += 1
        return False

    def detect_subject(self, frame):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = self.face_cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=4, minSize=(24, 24)
        )
        if len(faces) > 0:
            best = max(faces, key=lambda f: f[2] * f[3])
            fx, fy, fw, fh = int(best[0]), int(best[1]), int(best[2]), int(best[3])
            cx = fx + fw / 2.0
            cy = fy + fh / 2.0
            face_ratio = fw / self.src_w
            return cx, cy, face_ratio, "face"

        if self.body_cascade is not None:
            bodies = self.body_cascade.detectMultiScale(
                gray, scaleFactor=1.05, minNeighbors=3, minSize=(40, 60)
            )
            if len(bodies) > 0:
                best = max(bodies, key=lambda b: b[2] * b[3])
                bx, by, bw, bh = int(best[0]), int(best[1]), int(best[2]), int(best[3])
                cx = bx + bw / 2.0
                cy = by + bh * 0.35
                return cx, cy, bw / self.src_w, "body"

        return None, None, None, None

    def update(self, frame):
        if self.detect_scene_change(frame):
            self.smooth_cx = self.src_w / 2.0
            self.smooth_cy = self.src_h * self.vertical_anchor

        cx, cy, face_ratio, detection_type = self.detect_subject(frame)

        if cx is not None:
            tx = cx
            ty = cy
        else:
            tx = self.src_w / 2.0
            ty = self.src_h * self.vertical_anchor
            self.alpha = 0.06
        if cx is not None:
            self.alpha = 0.25

        self.smooth_cx = self.alpha * tx + (1.0 - self.alpha) * self.smooth_cx
        self.smooth_cy = self.alpha * ty + (1.0 - self.alpha) * self.smooth_cy
        if face_ratio is not None:
            self.smooth_face_ratio = 0.15 * face_ratio + 0.85 * self.smooth_face_ratio

        return self.smooth_cx, self.smooth_cy, detection_type


def compute_crop_params(src_w, src_h, target_w, target_h, face_ratio, zoom_factor=1.0):
    target_ratio = target_w / target_h
    src_ratio = src_w / src_h

    if face_ratio and face_ratio > 0:
        desired_crop_w = src_w * min(max(face_ratio * 2.5, 0.3), 0.85)
    else:
        desired_crop_w = src_w * 0.7

    desired_crop_w *= zoom_factor
    crop_w = int(desired_crop_w)
    crop_h = int(crop_w / target_ratio)

    if crop_h > src_h:
        crop_h = src_h
        crop_w = int(crop_h * target_ratio)
    if crop_w > src_w:
        crop_w = src_w
        crop_h = int(crop_w / target_ratio)

    crop_w = max(crop_w, 64)
    crop_h = max(crop_h, int(64 / target_ratio))

    return crop_w, crop_h


def smart_reframe(input_path, output_path, target_w=1080, target_h=1920,
                  audio_path=None, subtitle_path=None):
    """
    Reframe a horizontal video to vertical with intelligent face tracking.

    Pipeline:
      1. Open source video with OpenCV
      2. Detect and track the main subject per frame
      3. Compute smooth dynamic crop coordinates
      4. Pipe cropped+resized frames to ffmpeg for high-quality encoding
      5. Mux audio and burn-in subtitles in a second pass

    Args:
        input_path:  source video file
        output_path: destination video file (9:16 vertical)
        target_w:    output width  (default 1080)
        target_h:    output height (default 1920)
        audio_path:  optional audio file to mux (if None, uses source audio)
        subtitle_path: optional SRT to burn in
    """
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    print(f"[smart_reframe] source {src_w}x{src_h} @ {fps:.1f}fps, "
          f"{total_frames} frames -> target {target_w}x{target_h}")

    tracker = SubjectTracker(src_w, src_h)

    raw_video = output_path + ".raw.mp4"
    try:
        cmd = [
            "ffmpeg", "-y",
            "-f", "rawvideo", "-vcodec", "rawvideo",
            "-s", f"{target_w}x{target_h}",
            "-pix_fmt", "bgr24",
            "-r", f"{fps:.3f}",
            "-i", "pipe:0",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20",
            "-pix_fmt", "yuv420p",
            "-threads", "2",
            "-x264-params", "threads=2:bframes=0:ref=1:me=dia:subme=0:rc-lookahead=10",
            "-movflags", "+faststart",
            raw_video,
        ]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE)

        frame_idx = 0
        prev_crop_w, prev_crop_h = 0, 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            smooth_cx, smooth_cy, det_type = tracker.update(frame)
            crop_w, crop_h = compute_crop_params(
                src_w, src_h, target_w, target_h,
                tracker.smooth_face_ratio,
            )

            crop_x = int(np.clip(smooth_cx - crop_w / 2.0, 0, src_w - crop_w))
            crop_y = int(np.clip(smooth_cy - crop_h / 2.0, 0, src_h - crop_h))

            cropped = frame[crop_y:crop_y + crop_h, crop_x:crop_x + crop_w]
            resized = cv2.resize(cropped, (target_w, target_h),
                                 interpolation=cv2.INTER_LANCZOS4)

            try:
                proc.stdin.write(resized.tobytes())
            except BrokenPipeError:
                break

            frame_idx += 1
            if frame_idx % int(fps * 2) == 0:
                pct = frame_idx / max(total_frames, 1) * 100
                print(f"[smart_reframe] {frame_idx}/{total_frames} frames ({pct:.0f}%) "
                      f"det={det_type}")

        cap.release()
        proc.stdin.close()
        proc.wait()

        if proc.returncode != 0:
            stderr = proc.stderr.read().decode(errors="replace")[-1000:]
            raise RuntimeError(f"ffmpeg encode failed (rc={proc.returncode}): {stderr}")

        print(f"[smart_reframe] video encoded: {frame_idx} frames")

        mux_cmd = ["ffmpeg", "-y", "-i", raw_video]

        audio_src = audio_path or input_path
        mux_cmd += ["-i", audio_src]

        if subtitle_path and os.path.exists(subtitle_path):
            mux_cmd += ["-i", subtitle_path]

        mux_cmd += ["-map", "0:v", "-map", "1:a?"]

        sub_idx = 2 if (subtitle_path and os.path.exists(subtitle_path)) else None
        if sub_idx is not None:
            mux_cmd += ["-map", f"{sub_idx}:s"]

        mux_cmd += ["-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest"]

        if sub_idx is not None:
            mux_cmd += ["-c:s", "mov_text", "-disposition:s:0", "default"]

        mux_cmd += ["-movflags", "+faststart", output_path]

        print(f"[smart_reframe] muxing audio: {' '.join(mux_cmd[:8])}...")
        mux_result = subprocess.run(mux_cmd, capture_output=True, text=True, timeout=120)

        if mux_result.returncode != 0:
            print(f"[smart_reframe] mux failed, using video-only: {mux_result.stderr[-500:]}")
            os.replace(raw_video, output_path)
            return

        print(f"[smart_reframe] done: {output_path}")
    finally:
        if os.path.exists(raw_video):
            try:
                os.unlink(raw_video)
            except OSError:
                pass


def get_video_info(path):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return None
    info = {
        "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        "fps": cap.get(cv2.CAP_PROP_FPS),
        "frame_count": int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
    }
    cap.release()
    info["duration"] = info["frame_count"] / max(info["fps"], 1)
    return info


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python smart_reframe.py <input> <output> [target_w] [target_h]")
        sys.exit(1)
    in_path = sys.argv[1]
    out_path = sys.argv[2]
    tw = int(sys.argv[3]) if len(sys.argv) > 3 else 1080
    th = int(sys.argv[4]) if len(sys.argv) > 4 else 1920
    smart_reframe(in_path, out_path, tw, th)
