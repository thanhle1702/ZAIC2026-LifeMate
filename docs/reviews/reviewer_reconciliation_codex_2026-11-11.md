# Đối chiếu reviewer1 / reviewer2 với pipeline Datyth hiện tại

Người audit: **Codex**. Ngày: **11/11/2026**.

## 1. Kết luận và phạm vi

Hai review có giá trị về cách phân tích lỗi trạng thái, nguồn gốc tham số và thiết kế đối chứng gold/audio. Tuy nhiên, **không có bằng chứng để kết luận harness chiếm 50–60% lỗi của hệ thống hiện tại**, cũng chưa có căn cứ để thay E1P bằng một goal compiler đầy đủ.

Reviewer2 phân tích `hungta/lifemate-zac2026`, PhoWhisper-large, Qwen3-4B-Instruct-2507, TF-IDF và LoRA v3-all. Repo đang dùng là Datyth: Gipformer ONNX, Qwen3.5-4B + adapter p1, native tool calling qua vLLM, E1P, schema/x-ref validation. Phê bình baseline khác không phải bằng chứng lỗi ở repo này.

Đã đọc toàn bộ hai file `reviewer1.md` và `reviewer2.md` trong repo mới, đối chiếu source, kit local, nhãn TRAIN và artifact đã hoàn tất. **Chỉ tạo báo cáo này; không sửa code, notebook, dữ liệu, evaluation script hay điều khiển job đang chạy.** Các probe CPU bên dưới dùng stub cách ly, không gọi model, không tạo hash hoặc bài nộp.

61.26 là kết quả tác giả công bố, chưa phải điểm pipeline Colab/local này đã tái lập. Các phần trăm quy lỗi và khoảng tăng điểm của hai reviewer không được coi là số đo.

## 2. Những phần hiện đã làm đúng

| Nội dung review | Đối chiếu implementation | Đánh giá |
|---|---|---|
| Kiểm schema trước khi thực thi | `agent.py:209–217`: `env.validate`, lỗi trả về model, không gọi `env.call` | Đã có; giữ lại. Kit `train/zaic_tools/validate.py:schema_error` xử lý required, types, enums, range, format, x-one-of |
| Tool phải thuộc app đã cài | `data.py:installed_tools` dòng 40 và validator của kit | Đã có; không cần thêm TF-IDF gate |
| Không bịa ID | `agent.py:210–216`, `history.py:structured_history` | Có kiểm provenance cơ bản; độ hạt còn thô |
| Đóng vòng lặp bằng kết quả tool | `agent.py:execute`, dòng 238–253 | Đã có. Gọi đây là open-loop như reviewer2 là sai ngữ cảnh |
| History không chứng minh hành động nếu chỉ có assistant text | `history.py:successful`, `structured_history`; history gửi dưới dạng read-only | Có phân biệt kết quả verified và text chưa xác minh |
| Chuẩn hóa thời gian tương đối | `context.py:date_reference`, `agent.py:user_message` | Có bảng ngày/thứ và khoảng tuần, không giao toàn bộ phép tính lịch cho model |
| Phân biệt `ok:true` với thực sự hoàn tất | `history.py:outcome` xử lý `done:false` | Nền tảng đúng; cách tổng hợp lỗi trong agent còn cần sửa |
| Không tự đoán state hash | `agent.py:finish`, `submission.py:validate_file` | Hash lấy từ ToolEnv; validator replay lại call/hash |
| Đối chứng gold/audio | `dashboard_runner.py:run`, chế độ paired | Đã có, chưa cần dựng lại thí nghiệm từ đầu |
| Ghi log/checkpoint và tách metric | Runner, dashboard review, artifact evaluations/trace/validation | Có nền tảng quan sát và tái kiểm; một số thông tin gốc đang bị bỏ mất |
| SFT theo trajectory gold + ASR | README dòng 64, 154 và release recipe | Tác giả đã làm. Không nên đề xuất như một thành phần hoàn toàn thiếu; chưa tái train trong phiên này |

Một ToolEnv inference được dùng xuyên suốt từng mẫu. Gold replay và validator là hoạt động đánh giá riêng, không được đưa kết quả vào quyết định inference. Cần tiếp tục giữ ranh giới này và kiểm quy định private khi đóng gói.

## 3. Thẩm định từng nhóm đề xuất

### ACCEPT — tiếp thu

1. **Đánh giá trạng thái và trajectory riêng.** Một metric F1 không đủ chứng minh hoàn thành tác vụ. Giữ hash match, F1, EM, completion riêng và phân tích lỗi theo từng nhóm.
2. **Schema validation trước execution.** Đúng, nhưng đã hiện thực; việc cần làm là kiểm thử hồi quy và đo rejected proposals, không thêm verifier thứ hai giống hệt.
3. **Đối chứng gold/audio trước thay ASR.** Đúng. Cần phân tích chênh lệch *trên cùng sample*, cả trường hợp gold đúng/audio sai và ngược lại.
4. **Không dùng giả định để điền ID hoặc tham số thiếu.** Đúng về mục tiêu; provenance nên được tăng độ chính xác tại chỗ có bằng chứng lỗi.
5. **Không bắt đầu bằng multi-agent hoặc RL thưa reward.** Hợp lý trong tài nguyên Colab hiện tại; chưa có bằng chứng cần chúng.

### ADAPT — áp dụng có giới hạn

| Đề xuất | Điều giữ lại | Điều cần thay đổi |
|---|---|---|
| Typed belief state / Goal Graph | Theo dõi entity đã thấy và kết quả hành động | Chưa tạo ontology goal cho mọi app. Bắt đầu từ registry tham chiếu + trạng thái kết thúc trong vòng lặp hiện có |
| Deterministic missing-info gate | Phân biệt required / x-one-of / optional; ưu tiên context/history hợp lệ | Schema không tự biết ý định/người nhận nào là đúng. Không ép một classifier quy tắc quyết định mọi ca |
| Static OOS routing | Dùng installed apps và mô tả app làm bằng chứng | Gate cứng theo keyword có thể loại nhầm app mới hoặc câu nói gián tiếp. Chưa thêm một router ngoài model |
| Minimal reads | Tái sử dụng quan sát còn hợp lệ | Không tự chèn một read cho mọi app; read thừa vẫn có thể làm lệch trajectory |
| Constrained decoding / enum ID | Hữu ích nếu còn nhiều lỗi format hoặc ID | Đo lỗi trước, test parser/template/version đang pin. Enum chỉ phản ánh tập quan sát, không chứng minh đúng ngữ nghĩa hay đầy đủ |
| ASR N-best / hotword | Thử trên nhóm lỗi entity/number/code-switch có downstream impact | Đang là Gipformer, không dùng trực tiếp `initial_prompt` của Whisper. Beam search hiện có không đồng nghĩa API đã trả N-best |
| Preference training | Có thể học từ lỗi recovery sau khi có split sạch | Chưa chạy Step-DPO K=8 đại trà; cần kiểm nhãn preference và chi phí trước |

### REJECT — không áp dụng như review khẳng định

- **“Harness chắc chắn là bottleneck duy nhất; đóng góp 50–60%.”** Reviewer1 gọi đây là prior, reviewer2 đưa nhiều phần trăm cụ thể nhưng không có attribution trên trace của repo này. Không suy ra tỷ lệ nhân quả từ việc đổi SDK giảm một ít điểm.
- **“Gỡ whitelist TF-IDF.”** Luồng E1P hiện không có cơ chế đó. Đây không phải công việc còn thiếu.
- **“Mọi lặp call đều vô ích.”** Sai đối với thao tác có hiệu ứng cộng dồn. TRAIN chứa trường hợp redeem hai lần giống hệt để đổi hai phần thưởng.
- **“Hai pha read rồi write là đủ mọi task, tối đa hai lượt model.”** Không đúng tổng quát: có chuỗi write tạo thực thể rồi cần kết quả để quyết định bước sau; query có thể phụ thuộc quyết định trước. Đọc một lần không biến toàn bộ tác vụ thành closed world. Trong nhãn TRAIN có 226/1.545 mẫu xuất hiện read sau write; thứ tự này tự nó chưa chứng minh mọi mẫu đều không thể reorder, nhưng cho thấy phải phân tích dependency trước khi ép hai pha.
- **“env.validate/shadow verifier chứng minh kế hoạch đúng.”** Validator kiểm schema; ID tồn tại, số dư đủ, thực thể đúng và mục tiêu đầy đủ là các vấn đề khác. Kit nói rõ ID không tồn tại có thể trả `ok:true, done:false`.
- **“Dynamic enum bảo đảm 100% không bịa ID và không lỗi.”** Chỉ có thể hạn chế chuỗi sinh theo enum đã dựng đúng; enum có thể thiếu, gán sai collection hoặc chứa ID của đối tượng không đúng. Không bảo đảm final state.
- **“Gold-text + verifier là trần năng lực, phần còn thiếu định lượng chính xác lợi ích Step-DPO.”** Sai: còn prompt, token budget, dữ liệu, quyết định missing-info, policy và generalization. Thí nghiệm đó không phải oracle tối ưu toàn cục.
- **Các dự báo +3 đến +12 điểm, giảm latency 30–45%, MVE dưới 45 phút.** Chưa đo trên cấu hình này; không dùng để cam kết.
- **Các giới hạn 6B/5B/25 giây và công thức fuzzy cụ thể.** Chưa được xác minh từ quy định chính thức trong đợt này. Kit local xác nhận schema/replay/call logging nhưng README được đọc không cung cấp đầy đủ công thức score. Không lấy văn bản review làm rule chính thức.

## 4. Những điểm chưa ổn trong code hiện tại

### P1 — Chống lặp đang chặn cả hành động hợp lệ

**Vị trí:** `agent.py:219–227`, `execute`, `dedup_calls=True` từ dashboard runner.

Cache theo `[name, arguments]` và chặn mọi lần lặp, bất kể read hay write, bất kể effect. Đã quét toàn bộ nhãn 1.545 mẫu TRAIN, thấy hai trường hợp gold gọi cùng `loyalty.redeem` hai lần:

- `train_0922`: đổi điểm lấy được bao nhiêu ly thì đổi hết; gold get_points → redeem → redeem.
- `train_1447`: đổi hai vé; gold get_points → redeem → redeem → weather forecast.

Probe CPU cách ly cho model đề xuất hai write giống nhau: chỉ một call được thực thi, termination vẫn `completed_write`. Đây là lỗi có bằng chứng, nhưng chưa đo phần đóng góp vào score public.

**Đề xuất:** phân biệt call lặp do vòng lặp với multiplicity có chủ đích. Không tắt chống lặp toàn cục. Cho phép write cộng dồn khi số lượng có bằng chứng trong request/observation và còn trong budget; read cache cần invalidation sau write liên quan. Nếu chưa xác định được effect từ schema, bắt đầu bằng policy nhỏ cho các tool/case đã xác minh, ghi rõ ngoại lệ và test.

**Kiểm chứng:** hai mẫu trên, một ca lặp ngoài ý muốn, read → write → read cùng arguments, và toàn bộ bộ paired cố định. Đếm cả false block và duplicate side effect.

### P1 — Sai hợp đồng kết thúc có thể bị tính là xử lý xong

**Vị trí:** `agent.py:166–178`; `dashboard_runner.py:145–149`; gateway/Hosted pin `max_tokens=512`.

`finish_reason` chỉ được log; text giống `<tool_call>` sinh `protocol_events` rồi vẫn đi tới `no_action` nếu parser không có call. Không có cơ chế riêng xử lý `finish_reason='length'` trước kết thúc.

Probe CPU đã xác nhận:

| Đầu ra model giả lập | Kết quả hiện tại |
|---|---|
| Chỉ text `<tool_call>…</tool_call>`, không native calls | 0 executed calls, `no_action` |
| Text dang dở, finish_reason=length | 0 executed calls, `no_action` |

Runner coi hai tình huống này là `completed` vì chỉ một số termination được đánh incomplete. Chưa biết tần suất trên run thật. `completed` hiện chủ yếu là xử lý không ném exception, không chứng minh user goal hoàn tất.

**Đề xuất:** một nơi phân loại termination: normal stop, missing-info, unsupported, output truncation, invalid protocol, execution failure, deadline. Với response bị cắt hoặc fake narration, repair tối đa một lần trong budget khi chưa commit thêm effect; nếu không phục hồi thì đánh incomplete. Không regex-execute JSON/text ngoài native tool contract. Tránh đổi `tool_choice` thành required vì sẽ phá OOS/no-action.

**Kiểm chứng:** 4 loại output hợp lệ/lỗi, stop bình thường sau read/write, OOS rỗng, truncated nhiều calls. Đo tỷ lệ phục hồi và thêm lượt model, không chỉ JSON-valid rate.

### P1/P2 — Registry ID mới ở mức app, chưa ở mức collection

**Vị trí:** `history.py:ids_in` dòng 7, `structured_history` dòng 37; `agent.py:213,245`.

`ids_in` gom các key `id` hoặc kết thúc `_id`; `observed_ids` lưu theo app. `x-ref='app.collection'` bị rút xuống app. Một ID đã thấy thuộc collection khác cùng app có thể lọt gate. Ngược lại, loại identifier nằm ở key khác hoặc trong dạng cấu trúc khác có thể chưa được nhận diện. ID người dùng/context cung cấp hợp lệ chưa được nạp như registry độc lập; không nên mặc định mọi ID như vậy đều được phép dùng, cần đối chiếu rule cụ thể.

**Đề xuất:** registry nhỏ `reference → ids + source tool/path`, lấy từ response/history hợp lệ. Giữ entity attributes cần disambiguation. Chỉ thêm mapping cho loại response đã được kiểm chứng. Có trạng thái unknown thay vì đoán cách map mọi collection.

**Kiểm chứng:** hai collection cùng app, ID nested, entity cùng tên, history verified/unverified; đo false allow và false reject. Chưa đo tần suất sai ở public nên không khẳng định đây là bottleneck lớn nhất.

### P2 — Recovery đã thành công vẫn bị giữ trạng thái lỗi

**Vị trí:** `agent.py:250`: `failed_write |= ...`; tổng hợp ở dòng 176.

Sau bất kỳ write `done:false`, flag lỗi không reset dù model phục hồi và write sau thành công. Probe CPU với một write fail rồi retry thành công kết thúc bằng `tool_error`. Runner có thể đánh incomplete và chặn download full public.

Giữ call lỗi trong log là đúng. Tuy nhiên, từng call outcome, runtime health, goal resolution và submission validity là các khái niệm riêng. Call lỗi vẫn ảnh hưởng trajectory; không nên xóa log hoặc đổi failed call thành thành công.

**Đề xuất:** theo dõi lỗi nào đã được phục hồi, phân biệt unresolved failure và recovered-with-errors; không kết luận task success chỉ từ việc từng có một write thành công. Chốt chính sách download dựa trên dữ liệu đầy đủ và các lỗi còn unresolved đã định nghĩa.

### P1 — Đánh giá chưa chứng minh generalization

**Vị trí:** README dòng 186–187; runner chọn đầu danh sách khi limit; score ở `metrics.py:35`, `dashboard_review.py:review`.

Released p1 và final ASR đã học toàn bộ TRAIN, kể cả 200 validation IDs. Chạy 200 IDs đó với p1 không biến chúng thành held-out. TRAIN paired chỉ giúp tìm lỗi và kiểm hồi quy.

Artifact đã hoàn tất `v0-20` gồm 20 gold + 20 audio: strict F1=1.0, hash 20/20, sequence EM 20/20 ở cả hai nhánh. Đây là số đọc từ artifacts, không phải vừa chạy model lại. Không suy ra 100 điểm ZAIC hoặc ASR không còn lỗi.

**Đề xuất:** dùng full TRAIN hiện tại để phân loại failure, nhóm task, độ dài, missing/OOS, history, domain; tránh chỉ xem 20 mẫu đầu. Khi cần chọn thay đổi model/ASR thật, cần weights huấn luyện lại loại validation hoặc một tập đánh giá độc lập được phép sử dụng. Không fine-tune vào public answers và không dùng leaderboard làm validation duy nhất.

### P2 — Trace hiện thiếu thông tin để quy nguyên nhân

**Vị trí:** `dashboard_runner.py:102–149,161`; `Hosted.transcribe` dòng 41–44.

- `planning_started` được emit khi đã nhận `llm_turns`, tức sau request, nên UI không đánh dấu đúng thời điểm đang chờ model.
- Upstream có finish_reason, latency_seconds, protocol_events và termination details; adapter dashboard chưa lưu đầy đủ các trường đó.
- Exception theo sample chỉ giữ tên lớp, làm mất message/HTTP status có ích cho diagnosis.
- Không có stage timing đầy đủ. `latencyMs` được tính sau cả gold replay nên không phải latency inference thuần.
- Raw ASR đã bị normalize ở client trước khi được log dưới tên raw; không còn raw decoder text thực sự trong dashboard.
- Tool ID có provenance không đồng nghĩa entity đúng; trace cần cho biết target name/collection được lấy từ đâu.

**Đề xuất:** chuẩn hóa một event contract, giữ thông tin gốc an toàn: request_started/finished, finish_reason, HTTP/error kind, usage, decoder raw/normalized, env.validate result, executed vs blocked, outcome, stage duration, evaluator duration. Không log secret hoặc dump toàn bộ protected state.

### P2 — Policy hồi phục và cache còn quá thô

`retry_cap` đếm theo tên read tool, không theo query/dependency; hai lần rỗng có thể chặn query khác hợp lệ. `_empty_result` nhìn tất cả list cùng rỗng chưa chắc tương đương không có entity mục tiêu. Output tool bị cắt bằng số ký tự 16.000 có thể làm mất entity ở cuối hoặc cắt giữa JSON. ASR history chỉ cache trong mẫu, nên cùng audio có thể được transcribe lại ở mẫu khác.

**Đề xuất:** trước hết đo số lần bị cap/cắt và request lặp. Sau đó chọn một thay đổi nhỏ: cache ASR theo SHA audio + release + normalization, hoặc thay cắt chuỗi bằng giới hạn cấu trúc JSON còn hợp lệ. Không thêm retriever hoặc reranker nếu chưa chứng minh danh sách tool/context là nút thắt.

## 5. Phân tích tác dụng phụ

| Thay đổi | Cơ chế có thể bị suy yếu | Cách kiểm soát |
|---|---|---|
| Nới dedup cho quantity | Lặp write ngoài ý muốn | Multiplicity có evidence + bounded count; giữ loop budget |
| Xử lý output lỗi chặt hơn | Trước đây complete, giờ thành incomplete nhiều hơn | Báo rõ semantic/runtime status; repair giới hạn; không dùng completion làm accuracy |
| Registry collection | Chặn ID hợp lệ ở response chưa map | Mapping có test; log unknown; ablate trước enforce toàn cục |
| Repair protocol | Tăng latency và thêm calls | Không thêm env call khi sửa format; tối đa một request trong deadline |
| ASR normalization mới | Lệch phân phối SFT của p1 | Giữ lowercase hiện tại làm baseline; thay từng rule có đối chứng |
| Structured decoding | Ép gọi tool trên OOS, đổi optional/default | Giữ quyền dừng; kiểm semantics x-one-of, optional, native template theo vLLM pin |
| Thay Goal Graph | p1 không được train để sinh representation mới | Hoãn đến khi baseline lỗi rõ và có dữ liệu/ablation chứng minh |

Hai thay đổi cấu trúc đủ gọn cho vòng sửa tiếp theo: **(1) thống nhất outcome/event contract** và **(2) sửa registry/cache theo reference và effect**, giữ vòng lặp native E1P. Không cần thêm agent mới.

Tài liệu vLLM phân biệt tool parser và constrained decoding; khả năng áp constraint phụ thuộc parser, tool choice và chế độ strict. Đây là lý do không coi việc bật parser là bảo đảm schema. Tài liệu latest chỉ dùng để đối chiếu nguyên lý, không chứng minh mọi flag đều có trong vLLM 0.32.0 đang pin: [vLLM Tool Calling](https://docs.vllm.ai/en/latest/features/tool_calling/).

## 6. Thứ tự đề xuất sau khi run hiện tại hoàn tất

| Ưu tiên | Việc làm | Chi phí / rủi ro | Điều kiện chấp nhận |
|---|---|---|---|
| 1 | Đóng băng baseline + phân loại lỗi paired full TRAIN; lưu revision, IDs, settings và artifacts | Không cần train; không trộn model identity | Đủ mẫu hoặc ghi rõ partial; mỗi lỗi có trace và subgroup |
| 2 | Outcome/event contract: phân biệt truncation/protocol/recovered failure, timing/raw ASR chính xác | Nhỏ–vừa; cần regression request budget | Các probe trên chuyển đúng trạng thái, không phá normal/OOS/missing; đo recovery thật |
| 3 | Sửa dedup theo multiplicity/effect, read invalidation | Vừa; có nguy cơ duplicate side effect | Sửa được hai gold cases, không tăng write lặp ngoài ý muốn trên paired set |
| 4 | Tăng precision provenance theo collection nếu trace cho thấy false allow/reject | Vừa; mapping có thể quá chặt | Đo được giảm lỗi target/hash, không chỉ tăng tỷ lệ block |
| 5 | Chọn nhánh ASR hoặc policy theo gold/audio gap của nhóm khó | Tùy kết quả; không mặc định đổi ASR | Paired gain có bằng chứng và latency chấp nhận được |
| 6 | Schema-constrained output hoặc targeted recovery SFT | Cần test Colab, có thể phải chạy lại notebook | Chỉ triển khai khi lỗi format/recovery có tần suất đáng kể; validation độc lập |
| 7 | Goal compiler, N-best đa model, Step-DPO | Cao; đổi phân phối và tăng chi phí | Có baseline, split sạch, compute budget và ablation đủ mạnh để biện minh |

Đối chứng giữ nguyên sample, transcript cache, model/revision, prompt, seed, tool catalog, budget và scorer. Đo hash rate, strict F1, sequence EM, false missing-info, OOS exact-empty, calls/sample, p50/p95 và incomplete rate. Khi có reference matching/fuzzy scorer chính thức mới thêm metric đó dưới đúng tên/version.

Thay đổi nhỏ phải sửa đúng nhóm lỗi đã nêu và không gây regression ở ca bình thường. Với thay đổi ảnh hưởng policy rộng, dùng paired confidence interval/bootstrap theo sample (nhóm chung audio/history khi cần) và báo cả gain lẫn loss; không đặt một mức “phải +X điểm public” chưa có căn cứ. TRAIN in-sample không chứng minh generalization dù confidence interval hẹp.

## 7. Bằng chứng đã chạy và điều chưa đo

- Đã đọc hai review, source hiện tại và kit local. Không chạy lại bộ test hay benchmark GPU trong lần phân tích này.
- Đã scan 1.545 TRAIN labels: hai trajectory có identical redeem lặp; 226 trajectory có read xuất hiện sau write. Đây là thống kê morphology, không phải error frequency.
- Đã chạy bốn probe CPU cách ly: duplicate write bị chặn; fake tool text thành no_action; successful retry vẫn tool_error; finish_reason=length không calls thành no_action. Không tạo submission/hash.
- Đã đọc run hoàn tất v0-20. Run v1 còn đang xử lý ở thời điểm snapshot; không dùng kết quả chưa hoàn tất để gán score hay kết luận bottleneck.
- Chưa đo tần suất các lỗi termination/registry trên toàn bộ run, chưa tái lập public score 61.26, chưa xác minh toàn bộ rule/runtime limits hoặc official scoring formula.

**Quyết định kỹ thuật đề xuất:** giữ baseline native E1P; sửa những hợp đồng đã có phản ví dụ; đo gold/audio và lỗi theo nhóm trước khi đổi kiến trúc hoặc train lại.
