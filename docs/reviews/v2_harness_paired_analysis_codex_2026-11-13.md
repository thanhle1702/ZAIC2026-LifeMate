# Phân tích full TRAIN paired — v2-harness — Codex

Ngày: **13/11/2026**. Run: `5f458ac6482c40159ff81c4f3dcde142`.

Chỉ đọc kết quả, source và schema rồi tạo báo cáo/JSON thống kê. Không sửa code, notebook, dataset, checkpoint hoặc kết quả run; không chạy model lại.

## 1. Kết luận chính

Pipeline đã xử lý đủ **3.090/3.090 lượt**: 1.545 gold-text và 1.545 full-asr trên cùng IDs. Run mang trạng thái failed vì có **5 lượt incomplete thuộc 4 sample**: 1 lượt gold và 4 lượt audio. Không phải run thiếu dữ liệu hoặc model đã dừng giữa chừng.

Gold đạt **98,96% hash match**, audio **95,47%**. Khoảng cách ròng **3,50 điểm phần trăm** cho thấy đường đi từ audio/text format/history vào agent còn làm mất thành công trên nhóm TRAIN này. Chưa thể gọi toàn bộ khoảng cách đó là lỗi ASR âm học.

Có lỗi thật trong hai guard của bản sửa: khóa filter dự đoán ban đầu quá chặt và cấp quyền lặp redeem dựa quá nhiều vào động từ đúng chữ “đổi”. Cần sửa hẹp hai điểm này trước. Sau đó làm đối chứng normalized-gold/history, rồi mới quyết định đầu tư vào ASR hay SFT.

**Đây là đánh giá in-sample:** released p1 và final ASR đã học toàn bộ TRAIN, kể cả validation IDs. Các số liệu không phải điểm official ZAIC và không dự đoán được điểm private/public.

## 2. Số đo từ artifacts

| Chỉ số | Gold-text | Full ASR |
|---|---:|---:|
| Số mẫu | 1.545 | 1.545 |
| Strict tool F1 trung bình | **95,56/100** | **92,46/100** |
| Hash match | **1.529/1.545 — 98,96%** | **1.475/1.545 — 95,47%** |
| Tool sequence exact match | **1.388/1.545 — 89,84%** | **1.309/1.545 — 84,72%** |
| Runtime completed | 1.544 | 1.541 |
| Runtime incomplete | 1 | 4 |
| Model requests | 5.097 | 5.108 |
| Executed tool calls | 3.545 | 3.551 |
| Latency p50 | 5,34 giây | 7,83 giây |
| Latency p95, cách tính percentile trong JSON phân tích | 10,42 giây | 14,45 giây |

Latency là wall-clock của từng mẫu qua API local/Colab, không phải GPU-only benchmark. Run có ngắt/resume, hardware/load/GPU identity không được ghi đủ để bảo đảm đối chứng latency có kiểm soát; không suy luận tốc độ private từ bảng này. Percentile UI có thể lệch nhẹ vì dùng quy ước index khác.

Validation cuối run kiểm nhánh audio: 1.545 dòng, 3.551 calls, replay hash nhất quán 1.545/1.545, schema/replay hợp lệ. Nó không chứng minh 1.545 yêu cầu đều làm đúng, vì hash replay so với output của chính agent khác với hash match đối chiếu gold.

Đã kiểm tra hai nhánh có cùng tập 1.545 IDs, expected calls và expected hashes. JSON thống kê lưu SHA256 của hai evaluations artifacts để nhận diện snapshot đã phân tích.

## 3. Đối chứng theo sample

| Hash correctness | Số mẫu |
|---|---:|
| Cả gold và audio đúng | **1.469** |
| Chỉ gold đúng | **60** |
| Chỉ audio đúng | **6** |
| Cả hai sai | **10** |

Audio có 70 hash failures: 60 thuộc nhóm gold có thể làm đúng và 10 thất bại trong cả hai nhánh. Có 6 ca audio tốt hơn gold, nên không thể coi transcript gold là oracle tối ưu tuyệt đối của policy/model.

Theo sequence EM: cả hai đúng 1.288, gold-only 100, audio-only 21, cả hai sai 136. Thứ tự và strict wording là diagnostic, không thay thế scoring official.

Không có full-run agent upstream trên cùng 1.545 audio để ablate harness. Không lấy 4 incomplete TRAIN hiện tại so với 19 incomplete PUBLIC cũ rồi kết luận đã giảm lỗi: khác split, sample và điều kiện chạy.

## 4. Missing information: không phải vấn đề “hỏi quá nhiều”

TRAIN có **217** mẫu với gold call sys.ask_missing_info.

| Quyết định có/không hỏi | Gold-text | Audio |
|---|---:|---:|
| Hỏi đúng trường hợp | 215 | 208 |
| Hỏi thừa | 1 | 3 |
| Bỏ sót cần hỏi | 2 | 9 |
| Precision | **99,54%** | **98,58%** |
| Recall | **99,08%** | **95,85%** |

Trong các TP, danh sách ask calls cũng exact-match nhãn trong artifacts (215 và 208 tương ứng). Đây là diagnostic trên TRAIN, không phải bảo đảm cho app mới.

Vì vậy, giảm hỏi lại bằng một luật chung sẽ có nguy cơ tăng hallucinated writes. Các ca cần sửa là những trường hợp cụ thể như bỏ sót channel cần hỏi hoặc hỏi sớm khi thông tin có thể truy từ app khác/history.

Gold-empty có 111 mẫu; gold branch giữ output rỗng đúng ở 110, audio ở 107. Gọi đây là **gold-empty behavior**, không tự gán tất cả là OOS vì empty có thể mang các ngữ nghĩa khác tùy case.

## 5. Bốn sample runtime incomplete

### train_0790 — ở cả gold và audio

Yêu cầu lấy thời gian họp “tuần sau nữa”, đặt chuyến đáp trước họp ba tiếng và hẹn lấy hộ chiếu hôm trước. Model tìm nhầm khoảng 12–18/10 rồi tìm flight 12/10; nhãn dùng flight 20/10.

Sau search rỗng, guard đóng băng route/date của lần thử đầu. Nó chặn cả đổi `HAN/DAD` thành `Hà Nội/Đà Nẵng`, rồi chặn những lần đổi ngày tiếp theo.

**Lỗi phối hợp:** model suy ra ngày ban đầu sai, còn guard coi suy đoán đó như ràng buộc người dùng. Alias địa danh tương đương cũng bị coi là đổi route. Source `action_policy.py:read_error` hiện so filter literal và chưa phân biệt explicit evidence với model guess.

**Đề xuất:** chỉ khóa giá trị có nguồn đủ rõ; cho phép sửa suy đoán khi observation/context cung cấp bằng chứng, chấp nhận alias tương đương đã xác minh. Giữ chặn date hopping không có căn cứ. Bảng date_reference hiện thiếu mốc “tuần sau nữa”; có thể thêm khoảng week-after-next gọn, không cần nhồi lịch dài vào prompt.

Phép kiểm gold proposal trước đó đưa thẳng call đúng nên không bắt được lỗi này. Đây là giới hạn của test harness đó, không phải bằng chứng đã kiểm hết hành vi hồi phục của model thật.

### train_0562 — audio search_unresolved

Gold yêu cầu mở album và output rỗng do khả năng app của mẫu không đáp ứng. ASR ra “alpume”; agent chuyển sang podcast_radio.search, tìm hai lần rỗng rồi bị cap.

**Đặc biệt:** hash match vẫn true vì các read không đổi state, nhưng strict F1=0 do gold calls rỗng. Đây là ví dụ hash đúng không đủ chứng minh đúng nhiệm vụ.

**Đề xuất:** kiểm hồi quy audio gây nhầm phạm vi giữa album/music và podcast/radio. Không thêm luật cấm mọi request chứa tên album; xử lý theo installed capabilities và ý định, có dữ liệu TRAIN đối chứng.

### train_1375 — audio retry_budget_exhausted

“Silverline Media” thành “syvelline media”; agent lại query “Sylvia Media”, “Sylvia”. Search rỗng rồi các fallback có near rộng hơn hoặc bỏ filter đều bị chặn.

`search_group` hiện chỉ nhận selector query/symbol/*_id, chưa biểu diễn selector `near` đúng cho tool này. Budget chung và policy “hai rỗng rồi khóa” ngăn cả fallback list hợp lệ về schema.

**Đề xuất:** xác định selector/fallback từ schema và evidence của mục tiêu, không chỉ từ ba tên field cố định. Khi filter là phỏng đoán tên riêng, cân nhắc một lần list rộng hơn có giới hạn nếu tool cho phép; không tự reserve từ danh sách chưa disambiguate.

### train_1447 — audio unresolved_tool_error

Gold “đổi điểm CineViệt lấy hai vé” bị ASR thành “coi điểm CineViệt lấy hai vé”. Model vẫn đề xuất redeem hai lần, nhưng guard multiplicity tìm chữ “đổi” nên chỉ cho thực thi một lần.

**Đây là hạn chế trực tiếp của bản vá vừa thêm.** Gold và scripted replay đều qua, nhưng biến thể ASR làm guard quá phụ thuộc từ khóa.

**Đề xuất:** gắn quantity với reward/object và effect đã quan sát, thay vì bắt buộc một động từ đúng chữ. Vẫn kiểm đủ điểm, bounded count và tránh dùng “hai vé” của một hành động khác để cấp phép redeem. Thêm đúng biến thể ASR TRAIN vào regression, không hardcode sample ID.

## 6. ASR: lỗi ít từ nhưng có thể đổi toàn hành động

Corpus WER của **lượt audio mới nhất**: **2.143 word edits / 34.703 reference words = 6,18%**, với NFC/lowercase/bỏ punctuation-symbol. Chưa có WER của history audio.

Ví dụ có bằng chứng từ text/trajectory:

| Sample | Biến đổi | Hậu quả |
|---|---|---|
| train_0707 | “hai mươi hai tháng mười” → “hai mươi tháng mười” | Tạo/dời họp sang 20/10 thay vì 22/10 |
| train_0769 | “nhom73 a còng …” | Model sinh recipient `nhom73a@…` thay vì `nhom73@…` |
| train_0664 | Chuỗi chữ số đọc thành lời | Model thêm một số 0 vào số điện thoại |
| train_1064 | “đổi điểm” → “đổi địa điểm” | Chuyển từ tạo lịch + loyalty sang dời lịch |
| train_1289 | “Rep mail” → “read mail” | Đọc mail/tạo reminder thay vì reply |
| train_1463 | “tập tám podcast” → “tám tập podcast” | Queue nhiều episode thay vì chọn episode số 8 |
| train_0983 | Mất phần tự sửa “à thôi khỏi” và điều kiện sau | Thực hiện reserve ngoài ý định tham chiếu |
| train_1260 | “ba trăm” → cụm giống tên người | Chọn hai transfer số tiền khác thay vì amount được nói |

Không nên sửa bằng cách ép một số điện thoại về 10 chữ số hoặc đổi mọi “bốn năm” thành 45: có thể làm hỏng dữ liệu hợp lệ. Số/địa chỉ/email cần xử lý theo ngữ cảnh field và nguồn bằng chứng, không ITN đại trà.

### Khoảng cách gold/audio không chỉ là WER

Trong 60 gold-only hash cases, **9 có normalized latest WER=0**:

train_0708, 0971, 1054, 1068, 1188, 1262, 1265, 1481, 1738.

Sáu có history và ba không có history. Các ca không history vẫn có thể khác về casing/dấu câu giữa raw gold và ASR; vLLM/runtime cũng có thể biến thiên. Ví dụ train_1054 cùng các từ nhưng agent chọn threshold 350 ở gold và 300 ở audio; train_1068 join phòng họp ở gold nhưng create ở audio.

Do đó, 60 ca không phải là 60 acoustic errors đã được xác nhận. Cần thí nghiệm **gold gốc → normalized gold cùng style ASR → ASR thực tế**, và đối chứng latest/history riêng. Trace hiện chỉ ghi transcript latest; history transcripts không được giữ đầy đủ để kết luận phần đóng góp.

## 7. Những lỗi còn lại ngay trên gold-text

16 gold hash failures cho thấy model vẫn có điểm yếu dù không có lỗi nghe:

- Điều kiện trên **tổng nhiều hành động**, chọn account trước khi transfer: train_0087, 1569.
- Phép tính phút, giờ hoặc quy đổi đơn vị: train_0959, 1056, 1408, 1435, 1533, 1558, 1564. Ví dụ train_1564 lệch amount một bậc 10; train_0959 log 100 phút thay vì 50.
- Grounding/history: train_0677 chọn sai người nhận; train_1246 hỏi meeting_id trước khi tra thông tin từ chat liên quan.
- Missing/scope của yêu cầu kết hợp: train_1123 tự chọn TV channel; train_1638 trả [] cho cả yêu cầu dù reminder là phần có thể thực hiện.
- Target/điều kiện thiết bị: train_1722 đọc trạng thái không giới hạn phòng rồi tắt thiết bị khác với hành vi nhãn.
- train_1696 có bất nhất label/runtime đã được ghi nhận từ audit trước: gold chat ID cần kiểm riêng với kit, không chỉnh model để học thuộc ID không được quan sát. Không sửa hoặc loại sample khỏi kết quả chính trong đợt phân tích này.

Đây là phân tích theo reference và observed trajectory, không khẳng định mọi nhãn là diễn giải duy nhất của utterance. Các ca câu nói mơ hồ hoặc giá trị ngầm cần đối chiếu history trước khi tạo dữ liệu cải tiến.

## 8. Vì sao sequence EM và strict F1 thấp hơn hash match?

| Trong các ca sequence mismatch | Gold | Audio |
|---|---:|---:|
| Cùng chuỗi tên tool, khác arguments | 130 | 161 |
| Cùng multiset tên tool nhưng khác thứ tự | 6 | 5 |
| Multiset tên tool khác | 21 | 70 |

Trong nhóm cùng chuỗi tên tool/khác args:

- **105 gold / 121 audio** chỉ khác các field được schema đánh dấu x-match:fuzzy.
- **14 gold / 13 audio** chỉ khác có/không tham số optional.
- **10 gold / 26 audio** có khác biệt non-fuzzy.
- Mỗi nhánh còn 1 ca kết hợp fuzzy và optional.

Các số này là số sample được phân nhóm, không phải số argument edits. Ví dụ content SMS, chat và email body chiếm nhiều khác biệt strict. Chưa có phép chấm fuzzy đã xác minh official, nên không kết luận tất cả những ca đó đều đúng hoặc sai theo ZAIC.

**Đề xuất:** tiếp tục giữ strict F1 để hồi quy, nhưng không tối ưu wording giống từng token gold chỉ để đẩy chỉ số này. Bổ sung diagnostic schema-aware matching có tên/version rõ sau khi kiểm công thức chính thức; giữ hash gate và call redundancy riêng. Không đổi evaluator hiện tại trong lúc review.

## 9. Ưu tiên tiếp theo đề xuất

### Ưu tiên 1 — sửa hẹp các guard đã có phản ví dụ

1. Tách filter có evidence với filter do model đoán; canonicalize alias route; cho phép sửa suy đoán sai theo observation.
2. Multiplicity theo quantity/reward/effect, chịu được biến thể ASR như “coi điểm”, giữ test chống quantity thuộc hành động khác.
3. Một fallback read có giới hạn theo schema khi selector không chắc chắn, thay vì khóa mọi variant sau hai empty. Không mở lại exploratory loop vô hạn.

Nghiệm thu bằng các case TRAIN 0790/1447/1375 cùng những ca read-loop và quantity đang qua; đo cả false allow, false block, call count và hash. Không chỉ đổi status để giảm incomplete.

### Ưu tiên 2 — thí nghiệm rẻ để tách bottleneck

Chạy trên nhóm lỗi đã xác định và một tập đối chứng cố định:

- Gold nguyên bản vs gold lowercase/bỏ punctuation theo style ASR vs actual ASR.
- Latest gold + history ASR, latest ASR + history gold trong chế độ TRAIN diagnostic.
- Lưu transcript history, critical spans và đầy đủ runtime identity. Nếu cần, lặp vài case text tương đương để đo biến thiên inference.

Giữ model, tool catalog, budget, seed và policy. Không cần chạy lại toàn bộ 3.090 lượt cho mỗi thay đổi nhỏ. Chọn subset có manifest rõ để kiểm nhanh, rồi mới full regression khi có ứng viên tốt.

### Ưu tiên 3 — cải thiện speech-to-action có mục tiêu

Nếu lỗi tập trung ở critical spans đã xác nhận: thử context hints từ profile/history cho tên riêng, normalization theo field cho number/email/time và dữ liệu ASR-error trajectories trên TRAIN. Không tự thay Gipformer bằng model lớn chỉ vì WER chưa bằng 0; tiêu chí là hash/call gain sau agent và chi phí inference.

Nếu normalized-gold cũng sai, ưu tiên tính điều kiện, số học, self-correction và grounding trong prompt/targeted SFT. Một vài phép tính deterministic có contract rõ có thể hữu ích; không cần một goal graph đầy đủ cho mọi app.

### Chưa ưu tiên

- Cấm hoặc giảm sys.ask_missing_info toàn cục: precision hiện cao.
- Rewrite toàn bộ planner hoặc registry ID: không có bằng chứng từ run này đủ để ưu tiên hơn hai guard lỗi rõ.
- Constrained decoding đại trà: không thấy output_truncated/invalid_protocol/model_error trong termination của run này; schema block chỉ 4 event mỗi nhánh. Structured output không sửa sai số tiền/người nhận hợp schema.
- SFT/DPO toàn tập ngay: p1 đã học TRAIN. Để đánh giá generalization, cần checkpoint/split thật sự sạch; chỉ bỏ 200 mẫu khỏi vòng train tiếp trên p1 đã học chúng không tạo ra held-out validation.
- Dùng 92,46/100 strict F1 như dự báo điểm public hoặc dùng TRAIN để hứa sẽ đạt trên 90.

## 10. Bằng chứng và giới hạn

Nguồn chính: job/manifest/validation và evaluations của run v2-harness; schema TRAIN; source `action_policy.py`, `agent.py`, `dashboard_runner.py`, `context.py`. Các số liệu chi tiết và danh sách paired failure IDs nằm trong file JSON cùng tên báo cáo.

Chưa có new public submission score, chưa chạy upstream-vs-remediated full audio ablation, chưa nghe lại toàn bộ audio lỗi, chưa có đủ history transcripts để tính history WER. Không có code/test/model run mới được thực hiện trong đợt phân tích này ngoài các phép thống kê CPU đọc artifacts.

**Kết luận:** pipeline xử lý ổn định phần lớn TRAIN và missing-info không phải vấn đề lớn hiện tại. Mất mát đáng chú ý nằm ở speech/text representation, các điều kiện/số liệu nhạy cảm và một vài guard quá chặt. Sửa hẹp guard trước, đo normalized-gold/history sau, rồi mới chọn đầu tư ASR hoặc targeted SFT.
