# Datyth LifeMate dashboard

Chạy `npm run dev` trong `D:/HCMUT/ZAIC-lifemate-datyth/dashboard`.
UI: http://127.0.0.1:5173/. Không có dữ liệu minh họa hay lịch sử cũ.

Notebook tải từ UI: lifemate_datyth_vllm_colab.ipynb, dùng L4/A100, Qwen3.5-4B + p1 qua vLLM và Gipformer. Không cần source ZIP cũ. Nhập URL tunnel HTTPS và cùng API key của Colab trong UI. Key chỉ ở bộ nhớ backend, không lưu artifact.

Runner mới: src/lifemate/dashboard_runner.py, chạy bằng .venv-local; agent E1P và ToolEnv upstream giữ nguyên. Có gold-text, full-asr, paired; dừng/tiếp tục/xóa phiên. Resume từ mẫu hoàn tất, chạy lại mẫu dở, từ chối nếu code/input/config thay đổi. Đóng tab không dừng worker.

Kết quả nằm trong results/<train-test|public-test>/<run-id>/. Public đủ mẫu, không lỗi và replay hợp lệ mới tạo submission.jsonl và mở nút tải có kiểm checksum. Không tự nộp bài.

p1 đã học toàn bộ TRAIN kể cả 200 ID validation: số đo TRAIN chỉ là chẩn đoán. Strict tool F1, sequence EM, hash match, WER, latency là diagnostic. Task success và điểm tổng hợp không tự tạo khi chưa xác minh công thức chính thức. Trong biểu đồ, chọn State hash match hoặc Tool F1; public chưa có GT chỉ có completion và điểm ZAIC do người dùng nhập sau nộp.

Dataset vẫn là junction tới repo cũ. Không xóa D:/HCMUT/ZAIC-lifemate/data.
