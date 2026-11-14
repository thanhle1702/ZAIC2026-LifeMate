# Baseline Datyth trên Colab vLLM — Codex

Quyết định cuối của người dùng: **L4 24 GB hoặc A100 trên Colab**, không host model ở laptop. Repo mới: `D:\HCMUT\ZAIC-lifemate-datyth`. Repo cũ/dashboard/dataset giữ nguyên. Dataset được nối bằng junction `data/train+public_test` tới `D:\HCMUT\ZAIC-lifemate\data`; không xóa thư mục data gốc.

## Trạng thái đã xác minh

- Clone upstream tại `6ef76e00647bf44e14bcb084b58ef0c503584f55`, branch làm việc `colab-vllm-baseline`. Không sửa các file agent, prompt, context hay ToolEnv của upstream.
- HF release hiện public, không gated, revision `02080970ccd59a2e1aeec4fd66a17640da2cddf1`. Dùng Gipformer đã fine-tune + adapter **p1** trong release, không thay bằng Gipformer base chưa train.
- Base Qwen3.5-4B revision `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a`.
- Đã dừng download model và install Torch CUDA local khi người dùng đổi quyết định. Không có model server local. Một số file download dở còn ở `outputs/release/`; không phải checkpoint hoàn chỉnh.
- Môi trường `.venv-local` có dependencies CPU cho client/tests; không cần CUDA local. Có thể đã cài thư viện sherpa/soundfile ở lần chuẩn bị trước, nhưng runner hosted không nạp chúng hay weights.
- 20 test upstream chạy qua. Tổng 24 tests gồm thêm hosted client/gateway/notebook chạy qua bằng môi trường test CPU của project cũ; có 1 warning Starlette/httpx, 3 subtests passed. Gateway test dùng backend giả, không phải suy luận model thật.
- Notebook mới có cell Python compile được, chưa execute trên Colab. Chưa tải/nạp toàn bộ weights thành công, chưa có benchmark inference, chưa có điểm mới.

## Pipeline mới

```text
Local dataset + upstream agent E1P + ToolEnv
        │ HTTPS có Bearer key, gọi model từng bước
        ▼
Colab gateway :8000 (qua tunnel)
        ├─ Gipformer release ONNX / sherpa-onnx trên CPU Colab
        └─ vLLM :8001 loopback → Qwen3.5-4B BF16 + p1 LoRA trên L4/A100
        │ trả transcript/tool_calls
        ▼
Local ToolEnv → predictions, trace, diagnostic metrics, validation, submission
```

Native tool parsing do vLLM `qwen3_coder` xử lý; không tự viết parser mới. Giữ E1P, lowercase ASR, dedup-calls, retry cap2, max10turns, non-thinking, greedy seed42 như release. Notebook dùng context16.384, max-num-seqs1 và GPU memory utilization0.85; đây là cấu hình phục vụ một luồng, không đảm bảo bit-exact với bốn luồng của submission gốc.

`hosted_runner` là wrapper mới để bỏ yêu cầu GPU local của CLI gốc và gọi API HTTPS có xác thực. Không dùng CLI gốc trực tiếp: nó kiểm tra CUDA local và `LocalChat` chỉ chấp nhận loopback. Deadline mặc định của wrapper180giây là budget phát triển có tính network, **không phải giới hạn chấm chính thức**. Có thể đổi bằng `--seconds`.

## Cách chạy tiếp

1. Upload `notebooks/lifemate_datyth_vllm_colab.ipynb` lên Google Colab. Chọn L4/A100 và runtime mới, không chạy notebook Qwen3/Whisper cũ trong cùng phiên.
2. Tạo/bật notebook access cho Colab Secret `LIFEMATE_MODEL_API_KEY`, ít nhất32 ký tự. Dùng cùng secret tại local, không gửi vào chat.
3. Chạy install → GPU preflight/clone pin → models → vLLM → gateway → tunnel. Nếu pip yêu cầu restart session do package đã import, restart rồi chạy từ preflight. Không chạy helper tải model trên Windows; notebook tải model dưới `/content`.
4. Preflight từ chối GPU dưới22GiB hoặc không hỗ trợ BF16, không tự quantize/hạ context. File log khi lỗi: `/content/lifemate-vllm.log`, `/content/lifemate-gateway.log`, `/content/lifemate-tunnel.log`.
5. Copy HTTPS tunnel URL. Trên PowerShell local:

```powershell
cd D:\HCMUT\ZAIC-lifemate-datyth
$env:PYTHONPATH = "$PWD\src"
$env:LIFEMATE_MODEL_API_URL = Read-Host "URL HTTPS Colab"
$secret = Read-Host "Cung secret Colab" -AsSecureString
$env:LIFEMATE_MODEL_API_KEY = [System.Net.NetworkCredential]::new("", $secret).Password

# Smoke một mẫu, không phải benchmark chất lượng.
.\.venv-local\Scripts\python.exe -m lifemate.hosted_runner --split train --mode gold-text --limit 1 --output outputs\smoke-gold-01

# Sau khi smoke ổn: chạy audio qua Gipformer thật.
.\.venv-local\Scripts\python.exe -m lifemate.hosted_runner --split train --mode full-asr --limit 20 --output outputs\smoke-audio-20
```

Mỗi lệnh cần output mới, không append/trộn run cũ. Chưa có pause/resume trong wrapper mới; Ctrl+C giữ những dòng predictions/trace đã flush nhưng chưa tạo submission để nộp. Lặp lại smoke trong folder mới.

Sau khi kiểm tra đường chạy và ngân sách, lệnh full public (không chạy tự động trong đợt này):

```powershell
.\.venv-local\Scripts\python.exe -m lifemate.hosted_runner --split public_test --mode full-asr --limit 0 --output outputs\public-colab-p1-01
```

`predictions.jsonl` lưu dần; `trace.jsonl`, `metrics.json`, `manifest.json` để debug. Kết thúc sẽ replay schema/hash bằng validator của repo. Chỉ tạo `submission.jsonl` khi full public hoàn tất, không có lỗi runtime/duplicate-loop và validation qua. Không tự gửi bài nộp. Shape hiện dùng `id/tool_calls/state_hash` của validator repo; không tự thêm cột `time` theo ví dụ Docker khi chưa thống nhất yêu cầu upload của BTC.

Khi dùng xong, đổi `STOP_SERVERS=True` ở cell cuối rồi chạy cell đó, sau đó disconnect/delete runtime. Mặc địnhFalse để Run All không tự tắt server vừa khởi động.

## Dashboard và giới hạn

**Dashboard cũ vẫn giữ nhưng chưa nối sang runner mới.** Đừng đưa endpoint này vào cấu hình Qwen3/Whisper cũ: pinned identity/schema khác. Hiện chạy smoke bằng terminal và xem artifacts. Bước tiếp theo là xác nhận Colab nạp được release và trả tool call thật, rồi nối backend mới vào các nút chạy/live/pause-resume của dashboard; không giả vờ backend đã tương thích để tiếp tục dùng worker cũ.

61.26 là số tác giả công bố tại [repo upstream](https://github.com/Datyth/ZaloAI-Challenge-lifemate), chưa được tái lập trên Colab này. Releasep1 đã học toàn TRAIN, nên cả200 mẫu validation cũ cũng không còn độc lập. Metrics local hiện là strict-tool-F1 surrogate + hash match riêng, không phải scorer fuzzy chính thức. Không gọi test trên TRAIN là bằng chứng generalization và không hứa điểm61.26 tự chuyển sang project mới.

Không sửa thuật toán trước khi baseline vận hành được. Các khác biệt latency/điểm do serving, số luồng, floating point và tunnel cần được ghi rõ. Chưa xác minh quyền tái sử dụng checkpoint của team khác theo luật thi; không tự coi chạy được repo là submission hợp lệ hoặc redistribution license.
