# Đề xuất theo thứ tự 1–5 và nguyên nhân 19 mẫu public incomplete

Người phân tích: **Codex**. Ngày: **11/11/2026**.

**Phạm vi:** chỉ đọc source, job, evaluations và trace model/tool đã lưu; chỉ tạo báo cáo này. Không sửa code/notebook/dataset, không chạy model lại, không resume hoặc dừng job. Không tạo đáp án mới cho public và không đoán điểm ZAIC.

## 1. Trạng thái thực tế: chưa thể hoàn thành đối chứng full TRAIN

| Run | Trạng thái artifact | Kết quả có thể sử dụng |
|---|---|---|
| `v0-20`, `9ca16b0a1b364a2a96ef20b569eefe31` | completed, 40/40 lượt | Có 20 gold và 20 audio cùng sample; F1/hash/sequence đều đúng trong hai nhánh |
| `v1`, `ef398c9bbc644faf9661f2a9db24a2f6` | failed, 446/3090 lượt | Mới có 446 gold-text; không có nhánh full-asr tương ứng để tính paired gap |
| `v0-pub`, `c523c38ec5b3418aa28278e896366f71` | failed, đã xử lý 634/634 | 615 completed, 19 incomplete. Replay hợp lệ 634 dòng/1528 calls; không có GT để chấm chất lượng |

### Vì sao v1 dừng?

`job.json.message` ghi:

```text
PermissionError: [WinError 5] Access is denied:
job.json.<uuid>.tmp -> job.json
```

Nguyên nhân trực tiếp là thao tác `os.replace()` trong `dashboard_runner.py:atomic` bị Windows từ chối. Có khả năng file đang bị mở/khóa tạm thời bởi reader, antivirus hoặc tác nhân khác; **chưa xác định được tiến trình giữ file**, không kết luận cần quyền Administrator. Đây là lỗi ghi artifact, không phải bằng chứng GPU/model tắt.

446 gold-text đã lưu:

- 445 completed, 1 incomplete.
- Strict tool F1 trung bình: **98,9713%**.
- Hash match: **444/446**.
- Sequence EM: **431/446**.
- Hai hash mismatch: `train_0087`, `train_0295`.
- Không có proposal bị chặn bởi schema/x-ref/dedup trong steps của phần gold này.

`train_0087` có lỗi chọn tài khoản/điều kiện đủ số dư và chuyển sang `banking.open_savings` không phù hợp với trajectory nhãn. `train_0295` đặt xe sai điểm đến và giờ/ngày dù tool call thành công. Vì đây là gold-text, ít nhất hai sai lệch này không thể quy cho ASR.

Các weights p1/final ASR đã học toàn bộ TRAIN. Đây là chẩn đoán và hồi quy, không phải validation held-out. Không suy ra điểm public từ các tỷ lệ trên.

**Quyết định cho bước 1:** run không còn chạy nên không thể chỉ tiếp tục chờ. Trước khi chạy bù cần đề xuất sửa độ bền ghi file; sau đó mới thu đủ gold/audio trên đúng manifest sample và cấu hình baseline. Không dùng riêng 446 gold để suy luận ASR gap.

## 2. Nguyên nhân 8 mẫu tool_error

Tất cả tám mẫu đều có ít nhất một write được ToolEnv nhận về mặt schema nhưng trả `ok:true, done:false`. Đây là thất bại điều kiện nghiệp vụ, không phải JSON sai, lỗi mạng hay model server tự tắt.

| Sample | Sự kiện thực thi được quan sát | Hành vi sau đó | Phân tích |
|---|---|---|---|
| `public_0120` | Transfer lần hai từ tài khoản thanh toán không đủ số dư | Chuyển khoản đó từ tài khoản tiết kiệm thành công | Có recovery, nhưng flag failed_write vẫn giữ. Còn có dấu hiệu chọn sai amount so với transcript: yêu cầu điện thoại, bill list có phone 197.000 nhưng transfer đầu dùng 849.000 của electricity. Chưa có GT/audio gold để kết luận toàn tác vụ đúng |
| `public_0330` | Pantry hiển thị đậu hũ stock=0, model vẫn consume quantity=1 | Dừng, không có write hoàn tất tương ứng | Lỗi dùng dữ liệu tồn kho và hoàn thành mục tiêu; không chỉ là nhãn lỗi bị giữ |
| `public_0334` | Consume 5 cà chua trong khi tool trả chỉ còn 2 | Add shopping list quantity=3 thành công | Thành công ở mục tiêu mua thiếu không phục hồi thao tác consume trước đó. Không thể đổi cả mẫu thành success chỉ vì có write sau thành công |
| `public_0346` | Pantry đã cho biết 1 hộp, model consume 3 nên thất bại | Đọc recipe và add 2 hộp vào cart thành công | Có tiến triển ở nhánh mua, nhưng phần dùng hàng tồn chưa được thực thi thành công |
| `public_0492` | Book 2 chỗ cho chuyến chỉ còn 1 | Search bus và book 2 chỗ chuyến khác thành công | Recovery có bằng chứng tool; flag vẫn giữ. Không chứng minh lựa chọn cuối khớp GT |
| `public_0546` | Quote dùng các mã không tìm thấy; sau đó tune kênh `VTV61` không tồn tại | Guide trả channel list, tune `VTV1` thành công | Phục hồi được lệnh tune nhưng chưa xác minh điều kiện thị giá và nhánh hành động theo yêu cầu. Transcript méo là dấu hiệu cần kiểm audio, không phải bằng chứng định lượng lỗi ASR |
| `public_0610` | Hủy vé cũ thành công, book 3 chỗ cho chuyến chỉ còn 2 thất bại | Book chuyến khác 3 chỗ thành công | Có recovery; final tool_error vẫn do flag tích lũy |
| `public_0622` | Pay QR 760.000 thất bại vì ví không đủ | Pay 340.000 thành công | Có recovery/nhánh số tiền khác; chưa đủ để kết luận điều kiện người dùng được xử lý đúng |

Phân nhóm điều kiện nghiệp vụ của write thất bại: **3 tồn kho, 2 số chỗ, 2 số dư, 1 tên kênh không tồn tại**.

### Cơ chế biến các ca này thành incomplete

`agent.py:execute` dòng 248–250:

```python
failed_write |= result_outcome != "completed"
```

Flag không có trạng thái resolved. Khi model kết thúc không gọi tool tiếp, dòng 176 ưu tiên `tool_error` nếu từng có write fail. Runner dòng 146–147 đổi `tool_error` thành `incomplete`.

**Hai tầng nguyên nhân phải được giữ riêng:**

1. Tool thực sự từ chối thực hiện vì điều kiện nghiệp vụ; agent có thể đã bỏ qua dữ liệu nhìn thấy hoặc chọn sai đối tượng/nhánh.
2. Termination quá thô: chưa phân biệt lỗi đã phục hồi, lỗi của mục tiêu còn dang dở và tác vụ thực sự hoàn tất.

Sửa tầng 2 giúp báo cáo đúng hơn, không tự sửa tầng 1 và không chứng minh tăng điểm leaderboard. Không xóa call lỗi, không biến mọi ca có write thành công cuối cùng thành success.

## 3. Nguyên nhân 11 mẫu duplicate_loop

**Cả 11 mẫu đều kẹt ở tool đọc/search, không phải lặp write cộng dồn.** Phân bố:

- **5** mẫu kết thúc chỉ bởi các block `duplicate call blocked`.
- **5** mẫu kết thúc chỉ bởi các block `retry cap`.
- **1** mẫu có cả hai loại block.

`agent.py` đang dùng chung `duplicate_blocks` cho cả dedup và retry cap. Khi tổng block đạt 3, cả hai đường đều trả cùng tên `duplicate_loop`. Vì vậy tên này che khuất nguyên nhân thật của sáu ca có retry-cap.

| Sample | Chuỗi sự kiện chính | Cơ chế dừng và nguyên nhân gần |
|---|---|---|
| `public_0187` | Hai flights.search rỗng; model tiếp tục tăng ngày qua 28/29/30 | 3 retry-cap blocks; model đổi ngày thay vì giải quyết thiếu/không khớp dữ liệu |
| `public_0199` | Hai search tàu/xe rỗng; đổi ngày và thêm type | 3 retry-cap blocks; recovery không chuyển sang quyết định có căn cứ |
| `public_0252` | Một flights.search rỗng, sau đó lặp đúng query 3 lần | Dedup chặn đúng vòng lặp. Transcript nêu Quy Nhơn nhưng query destination=VCA: bất nhất cần kiểm mapping, không mặc định do ASR |
| `public_0388` | Tìm recipe/pantry rồi search ecommerce bí đỏ rỗng, rút query vẫn rỗng | Model luân phiên query rỗng thiếu required và query đã chạy; 3 dedup blocks. `grocery` cũng có trong installed tools nhưng model bị kẹt ở ecommerce; không suy ra phải tự động chuyển app trong mọi trường hợp |
| `public_0391` | Search tàu/xe theo hai chiều đều rỗng | Luân phiên bỏ required date và lặp query cũ; 3 dedup blocks. Cần phân biệt thông tin đi ga/tuyến buýt với truy vấn liên tỉnh; chưa có GT để gán nhãn đúng |
| `public_0409` | Search trả một món, search món khác rỗng, query ngắn trả lại món đầu | Lặp query không thấy món ba lần, không tiến tới chọn/clarify. Transcript tên món không rõ; ASR là giả thuyết cần nghe đối chiếu |
| `public_0436` | Hai mã cổ phiếu không tìm thấy | Thử thêm JCE/SE/SEW nhưng đều bị cap theo tên tool. Hai lần sai cho mã thứ nhất làm chặn cả mã khác: budget theo tool quá thô cho multi-entity |
| `public_0491` | Transcript có bãi xe/điều kiện chỗ trống; model lại tìm calendar và lùi ngày | 3 retry-cap blocks. `parking`/`translator` có sẵn nhưng không được khai thác trong trajectory; lỗi tool routing/điều kiện trước khi mắc loop |
| `public_0500` | get_ride không có chuyến; search maps hai query cửa hàng tiện lợi rỗng | 3 retry-cap blocks. Model tiếp tục đổi query thay vì xử lý dependency giao thông/giờ hẹn; transcript có nhiễu, chưa định lượng ASR |
| `public_0509` | save_place thành công; search công viên trả các địa điểm khác | Lặp đúng search ba lần rồi dedup dừng. Có `parking` nhưng không chuyển sang nhánh liên quan trong trajectory |
| `public_0567` | Funtomo/Funtoo đều không tìm thấy | 2 cap + 1 dedup blocks dùng chung counter. Tên riêng trong ASR là nghi vấn, không xác nhận được khi chưa nghe/không có gold |

### Điều này không chứng minh dedup đang sai trong 11 ca

Đa số block ngăn model tiếp tục làm điều không hữu ích. Tắt dedup hoặc nâng retry cap đại trà sẽ cho thêm call thừa, tăng latency và có thể không đổi kết quả.

Điểm cần sửa là: phân loại budget exhaustion đúng; giới hạn retry gắn với mục tiêu/entity; feedback recovery cụ thể; không để model bịa ngày, mã hay đổi query vô hạn; chỉ dùng fallback phù hợp schema và installed capabilities. Khi không có evidence để tiếp tục thì model phải kết thúc/clarify đúng policy, chứ không được harness tự chọn một write đoán mò.

Lỗi dedup write cộng dồn ở `train_0922`/`train_1447` vẫn đúng nhưng **là nhánh hồi quy riêng**, không dùng nó giải thích 11 read-loop của public.

## 4. Độ ưu tiên registry ID theo trace thật

Trên toàn bộ 634 public, steps ghi nhận:

| Loại proposal bị chặn | Số event |
|---|---:|
| retry cap | 32 |
| duplicate call blocked | 22 |
| thiếu required query | 11 |
| thiếu required date | 5 |
| x-ref provenance | 2 |

Đây là số **event**, không phải số mẫu lỗi; proposal bị chặn không nằm trong danh sách executed calls. Các loại block có thể cùng xuất hiện trong một mẫu và không phải mọi block đều dẫn đến incomplete.

Hai x-ref events:

- `public_0469`: đề xuất contact_id là message ID, gate chặn; mẫu kết thúc completed_write.
- `public_0510`: đề xuất product_id là tên sản phẩm thay vì ID, gate chặn; mẫu kết thúc completed_write.

Không có x-ref block trong 446 gold-text đã lưu. App-level registry vẫn có hạn chế cấu trúc như báo cáo trước, nhưng **trace này chưa chứng minh cần ưu tiên rewrite registry**. Số block thấp không chứng minh không có false-allow; cần audit riêng các wrong-target/hash mismatch trước khi quyết định.

## 5. Đề xuất triển khai, giữ đúng thứ tự người dùng

### Bước 1 — Hoàn tất baseline và paired error analysis

**1A. Sửa độ bền artifact writer trước khi chạy bù** (đề xuất, chưa làm): retry bounded với Windows sharing/access-denied tạm thời, dùng temp file cùng filesystem, chỉ báo mẫu committed sau khi artifact bắt buộc ghi thành công. Reader cần đọc snapshot và đóng file nhanh. Ghi winerror/path/attempt vào diagnostic riêng để tìm tác nhân lock. Không bắt mọi exception rồi im lặng bỏ mất kết quả.

**1B. Chốt manifest đối chứng:** cùng IDs, model/base/adapter/ASR revision, prompt, budget và policy. Không đổi harness giữa hai nhánh rồi gọi đó là ASR ablation. Dữ liệu 446 gold hiện có chỉ được tái sử dụng nếu đủ fingerprint và checkpoint nhất quán; nếu thay contract làm khác baseline thì tạo run riêng, không sửa artifact gốc để ghép kết quả.

**1C. Phân nhóm:** cả hai đúng, gold-only đúng, audio-only đúng, cả hai sai. Báo riêng hash và F1/EM. Những nhóm “đúng” này phải ghi rõ theo metric đang dùng, không tự gọi là task success official. Phân tầng domain, missing/OOS, history, numeric/temporal, multi-action và query rỗng. Phần full paired còn thiếu không được ước lượng bằng 20 mẫu.

**Nghiệm thu:** job không chết do file polling trong thử nghiệm ghi/đọc đồng thời; các kết quả cũ không đổi; paired IDs/identity khớp; báo cáo n/mẫu đầy đủ. Chỉ sau bước này mới quy ưu tiên ASR/policy từ paired gap.

### Bước 2 — Hợp đồng kết thúc và logging

- Tách runtime status, từng tool outcome, tình trạng mục tiêu còn unresolved và trạng thái sẵn sàng submission.
- Tách `duplicate_loop` với `retry_budget_exhausted`, đếm riêng block theo loại và goal/entity.
- Giữ thông tin recovered-after-failure; không dùng `failed_write` một bit để khẳng định toàn tác vụ thất bại vĩnh viễn. Không tự tuyên bố đã recovery đủ mọi goal.
- Với `finish_reason=length`, native call malformed hoặc fake narration: đánh output issue và repair tối đa một lần trong deadline khi phù hợp; không regex-execute text ngoài native protocol.
- Log request_started/finished, finish_reason, usage, stage latency, rejected/executed/outcome, termination reason, raw và normalized ASR đúng nghĩa. Inference latency phải dừng trước gold evaluation.
- Mọi call đã executed, kể cả done:false, vẫn nằm trong output. Gắn sẵn sàng tải submission theo policy rõ ràng; không chỉ đổi tên 19 ca để mở khóa nộp.

**Nghiệm thu:** regression cho normal stop, OOS, missing-info, truncated response, failure-recovery, failure chưa phục hồi; UI và artifact cùng số lỗi/reason. Số liệu không phụ thuộc có GT hay không.

### Bước 3 — Dedup theo quantity/effect, đồng thời xử lý read-loop đúng nguyên nhân

**Read:** giữ exact-query cache, bổ sung invalidation khi write liên quan đã đổi dữ liệu; budget tính theo dependency/entity, không khóa mọi entity dùng cùng một tên tool. Sau query rỗng chỉ cho fallback có thay đổi có căn cứ; không tự đổi ngày/địa điểm trái request. Query rỗng thiếu required phải bị chặn trước env.call như hiện tại. Khi hết budget, kết thúc/clarify rõ thay vì lặp phản hồi generic.

**Write:** phân biệt set/update có thể idempotent với hành động cộng dồn. Chỉ cho phép repeated additive effect khi multiplicity có bằng chứng từ request hoặc observation; bounded count, không bỏ loop guard. Dùng hai TRAIN redeem cases làm hồi quy, không hardcode ID sample.

**Precondition liên quan effect:** đối với balance/stock/seats đã có trong observation, kiểm tra tính nhất quán của amount/quantity khi mapping source và tool đã rõ. Không query state ẩn hoặc tự suy ra mọi business rule từ tên field. Lỗi pantry/ticket trong tám ca cho thấy cần học/kiểm tra dữ liệu đã thấy trước write, không chỉ sửa termination.

**Nghiệm thu:** không thêm read lặp vô ích vào submission; không chặn multiplicity hợp lệ; không tăng duplicate side effect; theo dõi outcome/hash/F1 và latency trên cùng baseline. Việc hết loop thành missing-info không tự được tính là cải thiện chất lượng.

### Bước 4 — Registry ID, chỉ khi audit thêm chứng minh cần

Hiện đề xuất **hoãn rewrite diện rộng**. Kiểm tra nguồn target ở các hash mismatch/wrong-target của TRAIN, đếm false allow/false reject. Nếu có bằng chứng thì nâng app-level set thành registry theo full x-ref collection + source tool/path, giữ provenance history verified. Không thay bằng fuzzy auto-rewrite ID thiếu kiểm chứng.

**Nghiệm thu:** test hai collection cùng app, IDs mới do write tạo, history verified/unverified, nhiều entity cùng tên; đo giảm wrong-target thực tế thay vì chỉ tăng block rate.

### Bước 5 — Chọn ASR, constrained decoding hoặc targeted SFT bằng kết quả

| Kết quả quan sát được | Ưu tiên đề xuất |
|---|---|
| Gold đúng/audio sai tập trung ở tên riêng, số, ngày và có entity corruption xác minh | ASR/normalization hoặc candidate handling có đối chứng; giữ Gipformer baseline |
| Native schema/JSON/required errors còn nhiều và có chi phí recovery | Thử structured decoding đúng parser/version; vẫn giữ quyền no-call/OOS |
| Gold cũng sai chọn app, quantity, điều kiện, recovery từ empty result | Targeted trajectory SFT bằng TRAIN + quan sát replay hợp lệ; dữ liệu recovery cân đối |
| Nhiều group lỗi đan xen | Ablate từng thay đổi, chưa thay cả pipeline hoặc chạy Step-DPO đại trà |

Public không có gold nên không thể xác nhận “do ASR” chỉ vì transcript nghe lạ. Không dùng các public case đã phân tích để tạo nhãn huấn luyện hoặc prompt hardcode. Dữ liệu cải tiến có giám sát phải lấy từ TRAIN hoặc nguồn được phép.

## 6. Những việc chưa làm và điều không nên làm

- Chưa sửa writer, agent, logging, dedup, registry hay notebook; toàn bộ nội dung trên là đề xuất.
- Chưa chạy lại 19 mẫu, chưa nghe đối chứng audio, chưa có full gold/audio v1; chưa dự báo gain public.
- Không xóa failed calls, không reset ToolEnv để thử đáp án khác trong inference, không đọc state ẩn để chữa output.
- Không tắt guard hoặc tăng lượt thử đại trà để chỉ làm trạng thái xanh hơn.
- Không coi 615 completed là 615 câu đúng; đó là số mẫu runner kết thúc không có flag incomplete, chưa có GT public.

**Kết luận:** bước đầu đang bị chặn bởi độ bền ghi artifact, không phải phải chờ GPU. Trong 19 public incomplete, hai nguyên nhân lớn là thực thi thiếu kiểm tra điều kiện nghiệp vụ và recovery sau query rỗng; termination policy hiện làm chúng khó phân biệt. Giữ đúng thứ tự 1–5, nhưng cần tách lỗi này thành các cơ chế nhỏ có đối chứng thay vì áp một bản vá chung.
