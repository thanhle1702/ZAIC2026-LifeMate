# Dashboard migration — Codex — 2026-11-11

Đã sao chép dashboard từ repo cũ sang `D:/HCMUT/ZAIC-lifemate-datyth/dashboard`, không di chuyển/xóa bản gốc, không chép node_modules, results hay mock runs. Cài dependency từ lockfile. UI dùng http://127.0.0.1:5173/.

## Tích hợp

- Backend kiểm release Datyth và model `lifemate`, không nhận Qwen3/Whisper cũ.
- Notebook download trỏ tới `lifemate_datyth_vllm_colab.ipynb`; bỏ nút source ZIP cũ.
- Worker mới `src/lifemate/dashboard_runner.py` dùng Hosted API, upstream E1P và ToolEnv. Không sửa agent upstream hoặc tải model local.
- Có train/public, gold/audio/paired, trace live, lịch sử, checkpoint từng mẫu, pause/resume/delete. Resume kiểm fingerprint code/config/input/catalog/release; không tiếp tục giữa chuỗi tool.
- Dữ liệu ở results riêng của repo mới. Submission chỉ tải sau full public, không mẫu lỗi và replay validation hợp lệ; backend kiểm SHA256 trước download.
- Giữ frontend phân tích/inspector/biểu đồ cũ. Không đưa điểm lịch sử từ repo cũ sang.

## Giới hạn số đo

p1 đã học toàn bộ TRAIN, kể cả 200 ID tham chiếu. UI ghi rõ đây là chẩn đoán. Strict F1, sequence EM, state hash, WER, latency có thể đo. Không tự đặt công thức task success/điểm tổng hợp: các chỉ số đó để chưa xác định. Chọn hash match hoặc Tool F1 trong biểu đồ để so sánh TRAIN; điểm ZAIC nhập sau nộp. Không suy ra nhãn OOS chỉ vì gold calls rỗng.

## Xác minh

Build frontend qua. 41 unit tests UI/backend qua. 12 kiểm thử browser đã qua theo nhóm: lần đầu 9 qua, 3 thất bại vì còn kỳ vọng engine/subset cũ; sửa kỳ vọng Datyth/all rồi chạy lại đúng 3 test đó đều qua. Browser thật mở trang không có page error; API jobs rỗng và connection chưa cấu hình.

Python tests kiểm pause/resume, fingerprint và artifacts dùng fixture cách ly, không phải điểm model thật. ToolEnv thật khởi tạo được bằng .venv-local với PYTHONPATH=src. Chưa chạy inference end-to-end trên GPU: cần người dùng nhập URL/key của notebook Colab mới. Không có benchmark mới hoặc điểm 61.26 được tái lập trong lần này.
