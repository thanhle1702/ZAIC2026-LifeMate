# Codex — triển khai gói sửa harness đã duyệt

Ngày: **11/11/2026**. Revision harness: **`e1p-remediation-v1`**.

## Trạng thái

Đã sửa code và chạy kiểm thử local cho năm phần được duyệt. Không khởi chạy inference TRAIN/public, không huấn luyện model, không sửa dataset hoặc zaic_tools. Model, ASR weights và notebook Colab giữ cấu hình hiện tại; không cần khởi động lại Colab cho gói thay đổi local này.

Kết quả cũ, bao gồm `v0-pub` với 19 incomplete, giữ nguyên. Chưa thể nói số lỗi đó đã giảm hoặc điểm public đã tăng khi chưa chạy lại model. Tạo run mới để benchmark code mới; fingerprint sẽ ngăn trộn checkpoint/code cũ vào policy mới. Run v1 cũ không được tự resume hoặc ghép lại trong đợt triển khai này.

## 1. Lưu tiến trình ổn định

`src/lifemate/artifacts.py:atomic_json`:

- JSON ghi vào file tạm cùng thư mục, flush/fsync rồi atomic replace.
- Retry tối đa 7 lần cho Windows error 5/32/33, backoff ngắn có giới hạn. Không retry mọi lỗi hoặc bỏ qua lỗi vĩnh viễn.
- Nếu thay snapshot thất bại, file đích cũ vẫn nguyên; file tạm được dọn sau đó.

`dashboard_runner.py:publish` ghi checkpoint trước evaluations projection và processed count. Nếu projection bị khóa sau khi checkpoint đã commit, resume cùng fingerprint có thể dựng lại projection và bỏ qua sample đã lưu; không gọi model lại cho sample đó.

Đã kiểm fault injection lỗi chia sẻ file tạm thời, lỗi vĩnh viễn có giới hạn và khôi phục sau projection failure. Chưa xác định tiến trình nào gây lock của v1 cũ, và không tuyên bố có thể chịu mọi lỗi filesystem.

## 2. Hợp đồng kết thúc và trace

`agent.py:execute`, `history.py:runtime_status`:

- Tách `retry_budget_exhausted`, `duplicate_loop`, `search_constraint_change`, `search_unresolved`, `unresolved_tool_error`, `output_truncated`, `invalid_protocol` và `recovered_with_errors`.
- Không thực thi một phần native call batch nếu response bị cắt hoặc native envelope/arguments sai. Format repair tối đa một lần, trong cùng turn/deadline budget.
- Không chuyển text giả dạng tool call thành executable call.
- Lỗi operation được ghi trong ledger nhỏ, có trạng thái unresolved/recovered/deferred_to_user. Recovery cần khớp operation; thành công ở shopping không chữa thất bại pantry. Transfer có thể đổi funding account nhưng phải giữ amount/payee. Ticket fallback chỉ ghép cùng operation khi có route/date/seats từ observation đủ rõ.
- `recovered_with_errors` là hợp đồng xử lý, không phải task success. Tất cả calls đã thực thi vẫn nằm trong env log/submission, kể cả done:false.

`dashboard_runner.py`, `hosted_runner.py`:

- Request started được phát trước khi chờ model; lưu finish_reason, usage, request error kind/HTTP status, protocol events và block categories.
- Raw ASR được giữ riêng với normalized text qua `Hosted.transcribe_result`; pipeline vẫn dùng cách normalize cũ.
- Inference latency chốt trước gold replay; speech/model/tools và evaluator duration được tách.
- Metadata/manifest ghi harness revision; runtime termination dùng chung giữa CLI và dashboard, tránh hai đường gating khác nhau.
- UI giữ operation issues/block counts trong live và inspector. Recovered được hiện cảnh báo riêng; chưa có GT thì task success vẫn unknown.

Guard rejection do policy được tách với lỗi schema trong trace. Không tăng metric schema-error chỉ vì dedup/retry/precondition đã chặn proposal.

## 3. Hồi phục search rỗng

`action_policy.py:search_group`, `read_error`, `record_read`:

- Budget theo nhóm entity/query; query rút ngắn cùng entity dùng chung budget. Entity khác được nhắc rõ trong request có budget riêng; biến thể đoán mò không tự mở vô hạn budget.
- Khi search đã rỗng, không tự thay date/route filter trong cùng nhóm nếu request không có dấu hiệu cho phép linh hoạt.
- Feedback nói rõ bị chặn vì sao và yêu cầu chuyển sang entity khác hoặc xử lý thiếu thông tin; prompt chỉ cho bỏ query khi schema cho phép.
- Dedup và retry-cap có bộ đếm/termination riêng.
- Thực thi thành công cho entity khác không xóa tình trạng search còn dang dở của entity cũ.

Giới hạn: nhóm entity hiện là heuristic bảo thủ dựa trên text/query; chưa phải semantic goal compiler. Các trường hợp nhiều tuyến/ngày diễn đạt phức tạp cần kiểm paired thực tế. Không tự chèn read/write hoặc tự gọi ask_missing_info thay model.

## 4. Dedup theo effect và multiplicity

- Read result được cache trong generation của app. Write thành công cùng app làm cache cũ hết hiệu lực, cho phép read lại state mới.
- Không thực thi lại failed write giống hệt khi chưa có observation mới.
- Repeated write mặc định vẫn bị chặn. Ngoại lệ hẹp hiện được kiểm chứng là `loyalty.redeem`: quantity có trong mệnh đề đổi thưởng hoặc redeem-all được hỗ trợ bởi points/cost nhìn thấy; giới hạn lặp tối đa 8 và vẫn chịu turn budget.
- Số lượng thuộc hành động khác, như “đổi một ly rồi đặt hai vé tàu”, không cho phép đổi thêm ly.

Không triển khai một bảng effect phỏng đoán cho mọi tool. Các additive tools khác vẫn cần evidence và test riêng trước khi nới guard.

## 5. Precondition từ dữ liệu đã quan sát

Chỉ có mapping hẹp cho các contract rõ:

| Tool | Kiểm tra |
|---|---|
| pantry.consume | quantity so với stock của item đã thấy |
| train_bus_tickets.book | seats so với seats_left của trip đã thấy |
| banking.transfer | amount so với balance của account đã thấy |
| ewallet.transfer / pay_qr / topup_mobile | amount so với wallet balance đã thấy |

Quantity của một số nguồn được cập nhật từ kết quả write/transition rõ ràng; observation cũ không được tái dùng bừa sau write. Nếu thiếu dữ liệu hoặc không có mapping được xác minh, guard không tự đoán capacity. Khi chặn, giữ proposal ngoài env.call và trả lý do cho model; không tự giảm tiền/số lượng hoặc đổi tài khoản.

Không truy cập state ẩn và không sửa registry x-ref đang dùng. App-level ID registry còn hạn chế; việc nâng collection-level tiếp tục là bước sau nếu trace benchmark chứng minh cần.

## Kiểm chứng

### Automated checks

- **50 Python tests passed**, 3 subtests; một warning deprecation của Starlette test client.
- **47 frontend/backend unit tests passed**.
- **13 Playwright tests passed**.
- Frontend build qua, `git diff --check` qua.

Các regression quan trọng: Windows temporary lock/permanent lock; checkpoint committed nhưng projection fail; truncated/fake tool response không gây partial execution; repair budget; per-entity search; read-after-write; repeated failed write; quantity không liên quan; known/unknown capacity; same-operation recovery vs unrelated success; inference/evaluator timing; raw/normalized ASR; live recovery metadata không tự tạo task success.

### Controlled gold proposal replay trên toàn TRAIN

Đây là scripted proposals từ nhãn TRAIN qua official ToolEnv và harness, **không phải model evaluation**. Baseline là source `agent.py` của upstream commit `6ef76e00647bf44e14bcb084b58ef0c503584f55`. Dùng cùng specs/input, 1.545 sample, một env độc lập cho mỗi lượt kiểm.

Kết quả lưu tại `docs/reviews/harness_controlled_replay_codex_2026-11-11.json`:

- Upstream có **10** sample mà executed calls không exact-match nhãn.
- Bản mới có **8** sample như vậy.
- Chỉ **hai** executed sequences thay đổi: `train_0922` và `train_1447`, đều sửa việc chặn lần redeem hợp lệ thứ hai.
- **Không có regression mới về call exact-match** trong phép kiểm này.
- Tám mismatch còn lại đã tồn tại ở upstream: train_0037, 0241, 1005, 1033, 1319, 1340, 1583, 1696. Không sửa nhãn/dataset để làm đẹp kết quả.

Phép kiểm chứng minh policy không thêm chặn nhầm trên các đề xuất gold đã thử; không chứng minh model sẽ sinh đúng proposal, không đo ASR, generalization, latency GPU hoặc gain ZAIC.

## Người dùng chạy tiếp

Refresh dashboard và tạo **run TRAIN paired mới**, đặt tên chẳng hạn `v2-harness`. Dùng cùng sample set, timeout và số lượt tối đa như baseline muốn đối chiếu. Không resume v1 cũ dưới code khác.

Đánh giá riêng hash/F1/sequence, số query bị chặn, operation unresolved/recovered và p50/p95. Số incomplete có thể tăng ở các trường hợp trước đây bị ghi completed dù còn lỗi; đó chưa phải bằng chứng agent kém hơn hoặc tốt hơn. Chỉ quyết định ASR/constrained decoding/targeted SFT sau khi có paired error analysis đủ dữ liệu.

Chưa nộp public và chưa tự chạy model benchmark trong đợt sửa này. Giữ nguyên URL/key Colab nếu phiên đó vẫn hoạt động; notebook không có thay đổi bắt buộc.
