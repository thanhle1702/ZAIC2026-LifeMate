"""Synth v2: generated tasks whose conventions are measured on the TRAIN labels (scripts in docs/experiments.md, 2026-11-15).

TRAIN conventions reproduced here
- 14% ask, 7% empty, 8% read-only, 71% write; 67% of the writes read first.
- Missing VALUE (time, amount, party size...): ask at once, without reading the target app (68 of 75 TRAIN asks).
- Ambiguous entity (the read returns two that fit): read, then ask for the ID parameter (contacts: 66 of 217 asks).
- The ask is always the last call; the other requested actions are done before it.
- An ID already observed in the history is used directly, without reading again (275 vs 41).
- Message and reminder contents are short paraphrases of what the user said.
Every task is replayed by scripts/data/build_synth_split.py with the official Session (schema, no no-op write)."""
from __future__ import annotations

import copy
import datetime as dt
import random
import unicodedata

from _common import ASK, C, T

WD = ["thứ hai", "thứ ba", "thứ tư", "thứ năm", "thứ sáu", "thứ bảy", "chủ nhật"]
UNITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"]
ME = ["anh", "chị", "tôi", "mình", "em", "cô", "chú", "tui", "tớ"]


def words(n: int) -> str:
    if n < 10:
        return UNITS[n]
    if n < 20:
        r = n % 10
        return "mười" + ("" if r == 0 else " lăm" if r == 5 else " " + UNITS[r])
    tens, r = divmod(n, 10)
    head = UNITS[tens] + " mươi"
    return head if r == 0 else head + (" mốt" if r == 1 else " lăm" if r == 5 else " tư" if r == 4 else " " + UNITS[r])


def fold(s: str) -> str:
    """Lower case without diacritics, like the simulators' substring search."""
    s = unicodedata.normalize("NFD", s.lower().replace("đ", "d"))
    return "".join(ch for ch in s if unicodedata.category(ch) != "Mn")


def iso(d: dt.date, h: int, m: int = 0) -> str:
    return f"{d.isoformat()}T{h:02d}:{m:02d}:00+07:00"


def slot(d: dt.date, h: int, m: int = 0) -> str:
    return f"{d.isoformat()}T{h:02d}:{m:02d}"


def period(h: int) -> str:
    return "sáng" if h < 11 else "trưa" if h < 13 else "chiều" if h < 18 else "tối"


def hour_text(rng, h: int, m: int = 0, today: bool = False) -> str:
    """Spoken clock time, e.g. bảy giờ tối / 7 giờ rưỡi tối / 19h30."""
    hh = h if h <= 12 else h - 12
    p = period(h)
    form = rng.random()
    if form < 0.15:
        return f"{h}h{m:02d}" if m else f"{h}h"
    num = words(hh) if form < 0.75 else str(hh)
    tail = " rưỡi" if m == 30 else ""
    return f"{num} giờ{tail} {p}" + (" nay" if today else "")


class Clock:
    """A 'now' and the spoken day phrases that resolve against it (week = Monday..Sunday, as in the date guard)."""

    def __init__(self, now: dt.datetime):
        self.now = now
        self.today = now.date()

    @property
    def stamp(self) -> str:
        return self.now.strftime("%Y-%m-%dT%H:%M:00+07:00")

    def day(self, rng, min_ahead: int = 1) -> tuple[str, dt.date]:
        wd = self.today.weekday()
        opts = []
        if min_ahead <= 1:
            opts += [("mai", 1), ("ngày mai", 1)]
        if min_ahead <= 2:
            opts += [("ngày kia", 2), ("mốt", 2)]
        for k in range(wd + max(min_ahead, 1), 7):
            opts.append((f"{WD[k]} này", k - wd))
        for k in range(7):
            ahead = 7 - wd + k
            if ahead >= min_ahead:
                opts.append((f"{WD[k]} tuần sau", ahead))
        for ahead in (3, 5, 8, 10, 12):
            if ahead >= min_ahead:
                d = self.today + dt.timedelta(days=ahead)
                opts.append((rng.choice([f"ngày {words(d.day)} tháng {words(d.month)}", f"ngày {d.day}/{d.month}",
                                         f"ngày {words(d.day)}"]) if d.month == self.today.month else
                             f"ngày {words(d.day)} tháng {words(d.month)}", ahead))
        phrase, ahead = rng.choice(opts)
        return phrase, self.today + dt.timedelta(days=ahead)


NOWS = [dt.datetime(2026, 11, d, h, mi) for d, h, mi in
        [(16, 8, 10), (17, 9, 30), (18, 7, 45), (19, 14, 0), (20, 10, 20), (21, 8, 0), (22, 16, 30), (23, 9, 0), (24, 11, 15),
         (25, 8, 40), (26, 13, 5), (27, 7, 30), (28, 9, 50), (29, 15, 10), (30, 8, 25)]] + \
       [dt.datetime(2026, 12, d, h, mi) for d, h, mi in [(1, 9, 0), (2, 10, 30), (3, 8, 15), (4, 14, 20), (5, 9, 40), (7, 8, 0)]]

CONTACT_POOL = [("Chị Hà", "chị gái"), ("Anh Khoa", "đồng nghiệp"), ("Mẹ", "mẹ"), ("Bố", "bố"), ("Linh", "bạn"), ("Anh Tuấn", "hàng xóm"),
                ("Chị Mai", "đồng nghiệp"), ("Thảo", "bạn"), ("Anh Phong", "anh trai"), ("Cô Hằng", "cô"), ("Bảo", "em trai"),
                ("Chị Ngọc", "chị họ"), ("Duy", "bạn"), ("Vợ", "vợ"), ("Chồng", "chồng")]


def contacts_state(rng, must: list[str]) -> dict:
    pool = [c for c in CONTACT_POOL if c[0] not in must]
    chosen = [c for c in CONTACT_POOL if c[0] in must] + rng.sample(pool, 4)
    rng.shuffle(chosen)
    return {"contacts": [{"id": f"c_{k + 1:02d}", "name": n, "relation": r, "phone": f"09{rng.randint(10000000, 99999999)}"}
                         for k, (n, r) in enumerate(chosen)]}


def contact_id(state: dict, name: str) -> str:
    return next(c["id"] for c in state["contacts"] if c["name"] == name)


def spoken_contact(name: str) -> str:
    return {"Mẹ": "mẹ", "Bố": "bố", "Vợ": "vợ", "Chồng": "chồng"}.get(name, name.lower() if name.split()[0] in ("Chị", "Anh", "Cô") else name)


# ----------------------------------------------------------------------------------------------------------------------------
# Venue apps: one adapter per app gives entities, the read that finds them, the write that books them, and the phrasing.

RESTAURANTS = [("Sen Vàng", "món Việt", "12 Lý Thường Kiệt, Hoàn Kiếm"), ("Mộc Quán", "món Huế", "45 Trần Quốc Toản, Quận 3"),
               ("Lẩu Nấm Rừng Xanh", "lẩu", "88 Nguyễn Chí Thanh, Đống Đa"), ("Hải Sản Biển Đông", "hải sản", "21 Võ Nguyên Giáp, Sơn Trà"),
               ("Bếp Nhà Mây", "cơm nhà", "7 Phan Đình Phùng, Ba Đình"), ("Nướng Than Hoa Phố", "đồ nướng", "102 Lê Văn Sỹ, Phú Nhuận"),
               ("Cơm Niêu Bà Tư", "cơm niêu", "33 Hai Bà Trưng, Quận 1"), ("Dimsum Hồng Lâu", "món Hoa", "9 Hàm Tử, Quận 5"),
               ("Gánh Bún Cô Ba", "bún", "16 Hàng Bông, Hoàn Kiếm"), ("Trattoria Olivo", "món Ý", "55 Thảo Điền, Thủ Đức"),
               ("Sushi Hana", "món Nhật", "70 Kim Mã, Ba Đình"), ("Chay Tịnh Tâm", "món chay", "24 Ngô Thời Nhiệm, Quận 3"),
               ("Lẩu Dê Năm Sánh", "lẩu dê", "140 Âu Cơ, Tân Bình"), ("Gà Nướng Ò Ó O", "gà nướng", "61 Tô Hiến Thành, Quận 10")]
BRANCHES = [("chi nhánh Cầu Giấy", "15 Trần Thái Tông, Cầu Giấy"), ("chi nhánh Hai Bà Trưng", "200 Bạch Mai, Hai Bà Trưng"),
            ("chi nhánh Quận 7", "8 Nguyễn Thị Thập, Quận 7"), ("chi nhánh Gò Vấp", "301 Quang Trung, Gò Vấp")]

DOCTORS = [("Nguyễn Thu Trang", "pediatrics", "Phòng khám Nhi An Khang", "khám nhi"), ("Lê Minh Quân", "dentistry", "Nha khoa Nụ Cười", "khám răng"),
           ("Phạm Hoài Nam", "ent", "Tai Mũi Họng Bình An", "khám tai mũi họng"), ("Trần Kim Oanh", "dermatology", "Da liễu Thiên Phúc", "khám da"),
           ("Võ Thanh Bình", "cardiology", "Tim mạch Tâm Đức", "khám tim mạch"), ("Đỗ Ngọc Lan", "ophthalmology", "Mắt Sáng Ngời", "khám mắt"),
           ("Hoàng Văn Sơn", "general", "Phòng khám Đa khoa Hòa Bình", "khám tổng quát"), ("Bùi Thị Hạnh", "dentistry", "Nha khoa Kim Cương", "khám răng"),
           ("Ngô Quốc Huy", "pediatrics", "Nhi đồng Ánh Dương", "khám nhi"), ("Lý Thu Hà", "dermatology", "Da liễu Hồng Phúc", "khám da")]
REASONS = {"pediatrics": ["bé bị sốt", "bé ho mấy hôm nay", "tiêm phòng cho bé"], "dentistry": ["lấy cao răng", "đau răng khôn", "trám răng"],
           "ent": ["viêm họng", "ù tai"], "dermatology": ["nổi mẩn ngứa", "trị mụn"], "cardiology": ["khám định kỳ", "hay hồi hộp"],
           "ophthalmology": ["mờ mắt", "đo lại độ cận"], "general": ["khám sức khỏe định kỳ", "xét nghiệm máu"]}

HOTELS = [("Đồi Thông", "Đà Lạt"), ("Hoa Hồng Boutique", "Đà Lạt"), ("Sea Breeze", "Nha Trang"), ("Phố Cổ", "Hội An"),
          ("Sóng Xanh", "Vũng Tàu"), ("Mây Ngàn", "Sa Pa"), ("Hạ Long Pearl", "Hạ Long"), ("Cát Trắng", "Quy Nhơn"),
          ("Lotus Garden", "Huế"), ("Biển Ngọc", "Phú Quốc")]
ROOM = {"standard": ["phòng thường", "phòng standard", "phòng tiêu chuẩn"], "deluxe": ["phòng deluxe", "phòng cao cấp"],
        "family": ["phòng gia đình", "phòng family"]}

CAMPAIGNS = [("Áo ấm cho em vùng cao", "giáo dục", "Quỹ Nắng Mai"), ("Cứu trợ lũ miền Trung", "thiên tai", "Hội Chữ thập đỏ phường"),
             ("Bữa cơm 0 đồng bệnh viện K", "y tế", "Nhóm Cơm Yêu Thương"), ("Thư viện cho trường làng", "giáo dục", "Quỹ Sách Xanh"),
             ("Phẫu thuật tim cho trẻ em", "y tế", "Quỹ Trái Tim Hồng"), ("Trồng rừng phòng hộ", "môi trường", "Hội Xanh Việt")]
CAMPAIGN_SHORT = {"Áo ấm cho em vùng cao": "áo ấm cho em", "Cứu trợ lũ miền Trung": "lũ miền Trung", "Bữa cơm 0 đồng bệnh viện K": "bữa cơm 0 đồng",
                  "Thư viện cho trường làng": "thư viện cho trường làng", "Phẫu thuật tim cho trẻ em": "phẫu thuật tim", "Trồng rừng phòng hộ": "trồng rừng"}
AMOUNTS = [(100000, "một trăm nghìn"), (200000, "hai trăm nghìn"), (300000, "ba trăm nghìn"), (500000, "năm trăm nghìn"),
           (1000000, "một triệu"), (1500000, "một triệu rưỡi"), (2000000, "hai triệu"), (250000, "hai trăm rưởi")]

COURTS = [("Sân cầu lông Hòa Bình", "badminton", "cầu lông", 120000), ("Sân cầu lông Thanh Xuân", "badminton", "cầu lông", 100000),
          ("Sân bóng Mini Lê Lợi", "football", "đá bóng", 400000), ("Sân bóng Phú Mỹ", "football", "đá bóng", 350000),
          ("Sân tennis Hồ Tây", "tennis", "tennis", 250000), ("Sân pickleball Sunrise", "pickleball", "pickleball", 180000),
          ("Sân pickleball Green", "pickleball", "pickleball", 160000)]


class Gen:
    def __init__(self, seed: int = 11):
        self.rng = random.Random(seed)
        self.tasks: list[dict] = []
        self.n = 0

    def add(self, kind: str, clock: Clock, text: str, gold: list, states: dict, **extra):
        self.n += 1
        self.tasks.append(T(f"v2_{kind}_{self.n:03d}", clock.stamp, text, gold, states, **extra))

    def clock(self) -> Clock:
        return Clock(self.rng.choice(NOWS))

    # -- restaurant_booking ---------------------------------------------------------------------------------------------------
    def restaurants(self, clock, target_day, target_h, target_m, picks, dup=False):
        r = self.rng
        out = []
        for k, (name, cuisine, addr) in enumerate(picks):
            free = sorted({slot(target_day, h, m) for h, m in [(11, 0), (11, 30), (12, 0), (18, 0), (18, 30), (19, 0), (19, 30), (20, 0)]
                           if r.random() < 0.6} | ({slot(target_day, target_h, target_m)} if k == 0 else set()))
            out.append({"id": f"rst_{k + 1:02d}", "name": f"Nhà hàng {name}" if r.random() < 0.5 else name, "cuisine": cuisine,
                        "address": addr, "max_party": 12 if k == 0 else r.choice([8, 10, 12, 20]), "free_times": free})
        if dup:
            first = out[0]
            b1, b2 = r.sample(BRANCHES, 2)
            first["name"] += f" {b1[0]}"
            first["address"] = b1[1]
            twin = copy.deepcopy(first)
            twin.update(id=f"rst_{len(out) + 1:02d}", name=first["name"].replace(b1[0], b2[0]), address=b2[1])
            out.insert(1, twin)
        return out

    def restaurant_tasks(self, count: int):
        r = self.rng
        for _ in range(count):
            c = self.clock()
            kind = r.choices(["book", "book_note", "dup", "missing", "cond_yes", "cond_no", "cancel", "change", "notfound",
                              "retract", "book_sms", "book_remind", "hist_direct", "hist_info", "check"],
                             [16, 5, 6, 6, 5, 2, 7, 5, 2, 4, 6, 5, 9, 6, 2])[0]
            picks = r.sample(RESTAURANTS, r.randint(3, 5))
            name = picks[0][0]
            day_p, day = c.day(r)
            h, m = r.choice([(11, 30), (12, 0), (18, 0), (18, 30), (19, 0), (19, 30), (20, 0)])
            n = r.randint(2, 10)
            t_p = hour_text(r, h, m)
            me = r.choice(ME)
            ppl = r.choice([f"{words(n)} người", f"{n} người", f"bàn {words(n)}"])
            when = r.choice([f"{t_p} {day_p}", f"{day_p} lúc {t_p}", f"{day_p} khoảng {t_p}"])
            rs = self.restaurants(c, day, h, m, picks, dup=(kind == "dup"))
            st = {"restaurant_booking": {"restaurants": rs, "reservations": []}}
            search = C("restaurant_booking.search", query=name)
            reserve = C("restaurant_booking.reserve", restaurant_id="rst_01", time=iso(day, h, m), party_size=n)
            if kind in ("book", "dup", "book_note"):
                note = r.choice(["có ghế em bé", "ngồi gần cửa sổ", "phòng riêng", "có người ăn chay"]) if kind == "book_note" else None
                text = r.choice([f"Đặt giúp {me} bàn {ppl} ở {name} {when} nhé.",
                                 f"{when.capitalize()} nhà mình đi ăn {name}, {ppl}, em giữ bàn trước giùm {me}.",
                                 f"Book bàn ở {name} cho {ppl}, {when} nha.",
                                 f"Em ơi giữ chỗ ở {name} {when}, {ppl} nhé."])
                if note:
                    text = text.rstrip(".") + f", ghi chú là {note}."
                    reserve["arguments"]["note"] = note
                gold = [search, ASK("restaurant_booking.reserve", "restaurant_id")] if kind == "dup" else [search, reserve]
            elif kind == "missing":
                which = r.choice(["party_size", "time"])
                if which == "party_size":
                    text = r.choice([f"Đặt bàn ở {name} {when} giúp {me}.", f"Giữ cho {me} một bàn ở {name} {when} nha."])
                else:
                    text = r.choice([f"Đặt bàn {ppl} ở {name} giúp {me} nhé.", f"Em book giùm {me} bàn {ppl} ở {name} {day_p}."])
                gold = [ASK("restaurant_booking.reserve", which)]
            elif kind in ("cond_yes", "cond_no"):
                if kind == "cond_no":
                    rs[0]["free_times"] = [x for x in rs[0]["free_times"] if x != slot(day, h, m)]
                text = r.choice([f"Xem {name} {when} còn bàn không, còn thì đặt {ppl} cho {me}, hết thì thôi.",
                                 f"Nếu {name} còn chỗ {when} thì giữ giúp {me} bàn {ppl} nhé."])
                gold = [search, reserve] if kind == "cond_yes" else [search]
            elif kind == "check":
                text = r.choice([f"{name} {day_p} còn những giờ nào trống vậy em?", f"Coi giùm {me} {name} {when} còn bàn không."])
                gold = [search]
            elif kind in ("cancel", "change"):
                old_h = r.choice([18, 19, 20])
                rsv = [{"id": "rsv_01", "restaurant_id": "rst_01", "time": iso(day, old_h), "party_size": n, "status": "booked"},
                       {"id": "rsv_02", "restaurant_id": "rst_02", "time": iso(day + dt.timedelta(days=r.randint(2, 6)), 12), "party_size": 4,
                        "status": "booked"}]
                st["restaurant_booking"]["reservations"] = rsv
                if kind == "cancel":
                    text = r.choice([f"Hủy cái bàn ở {name} {day_p} giúp {me}.", f"{day_p.capitalize()} {me} bận rồi, hủy đặt bàn {name} đi em.",
                                     f"Huỷ giùm {me} bàn {name} nhé, không đi nữa."])
                    gold = [C("restaurant_booking.list_reservations"), C("restaurant_booking.cancel_reservation", reservation_id="rsv_01")]
                else:
                    rs[0]["free_times"] = sorted(set(rs[0]["free_times"]) | {slot(day, h, m)} - {slot(day, old_h)})
                    if (h, m) == (old_h, 0):
                        h, m = old_h + 1, 30
                        rs[0]["free_times"] = sorted(set(rs[0]["free_times"]) | {slot(day, h, m)})
                    text = r.choice([f"Bàn ở {name} {day_p} dời sang {hour_text(r, h, m)} giúp {me}.",
                                     f"Đổi giờ đặt bàn {name} thành {hour_text(r, h, m)} nha em."])
                    gold = [C("restaurant_booking.list_reservations"),
                            C("restaurant_booking.change_reservation", reservation_id="rsv_01", time=iso(day, h, m))]
            elif kind == "notfound":
                ghost = r.choice(["Ngon Garden", "Quán Bụi Phố", "Lẩu Cua Đồng Bà Năm", "Phở Thìn Ký"])
                text = f"Đặt bàn {ppl} ở {ghost} {when} giúp {me}."
                gold = [C("restaurant_booking.search", query=ghost)]
            elif kind == "retract":
                text = r.choice([f"Đặt bàn {ppl} ở {name} {when}... à thôi khoan, để {me} hỏi lại mọi người đã.",
                                 f"Em đặt giúp {me} bàn ở {name} nhé, à mà thôi, {day_p} {me} nấu ở nhà rồi."])
                gold = []
            elif kind in ("book_sms", "book_remind"):
                text = f"Đặt bàn {ppl} ở {name} {when}"
                gold = [search, reserve]
                if kind == "book_sms":
                    who = r.choice(CONTACT_POOL)[0]
                    st["contacts"] = contacts_state(r, [who])
                    st["sms"] = {"messages": []}
                    msg = r.choice([f"{day_p} {t_p} ăn ở {name} nhé", f"đã đặt bàn {name} {day_p} lúc {t_p}"])
                    text += f", xong nhắn {spoken_contact(who)} là {msg}."
                    gold += [C("contacts.search", query=who), C("sms.send", contact_id=contact_id(st["contacts"], who), content=msg)]
                else:
                    st["reminders"] = {"reminders": []}
                    before = r.choice([(60, "một tiếng"), (30, "nửa tiếng"), (120, "hai tiếng")])
                    at = dt.datetime.combine(day, dt.time(h, m)) - dt.timedelta(minutes=before[0])
                    text += f", rồi nhắc {me} trước {before[1]} để đi."
                    gold.append(C("reminders.create", content=f"đi ăn ở {name}", time=iso(at.date(), at.hour, at.minute)))
                if not text.endswith("."):
                    text += "."
            elif kind in ("hist_direct", "hist_info"):
                found = {"ok": True, "restaurants": [x for x in rs if name.lower() in x["name"].lower()]}
                if kind == "hist_direct":
                    hist = [{"role": "user", "text": r.choice([f"{name} {day_p} còn bàn mấy giờ em?", f"Tìm giùm {me} quán {name} với."])},
                            {"role": "assistant", "text": f"{rs[0]['name']} ở {rs[0]['address']}, còn trống vài khung giờ.",
                             "tool_calls": [search], "tool_results": [found]}]
                    text = r.choice([f"Ừ đặt chỗ đó luôn, {ppl}, {when}.", f"Vậy giữ bàn {ppl} {t_p} {day_p} ở đó giúp {me}."])
                    gold = [reserve]
                else:
                    hist = [{"role": "user", "text": r.choice([f"{day_p.capitalize()} nhà mình đi ăn {name} nha, chắc {ppl}.",
                                                                f"Cuối tuần này… à không, {day_p} {me} rủ cả nhà đi {name}, tầm {ppl}."])},
                            {"role": "assistant", "text": "Dạ, em ghi nhận rồi ạ."}]
                    text = r.choice([f"Đặt bàn chỗ đó cho {me} luôn đi, {t_p} nhé.", f"Em book bàn quán lúc nãy giúp {me}, {t_p} nha."])
                    gold = [search, reserve]
                self.add("rst_" + kind, c, text, gold, st, history=hist)
                continue
            self.add("rst_" + kind, c, text, gold, st)

    # -- clinic -------------------------------------------------------------------------------------------------------------
    def clinic_tasks(self, count: int):
        r = self.rng
        for _ in range(count):
            c = self.clock()
            kind = r.choices(["book_name", "book_spec_dup", "book_spec_one", "missing_time", "cond_no", "cancel", "resched", "retract",
                              "book_remind", "hist_direct", "check"], [16, 7, 6, 7, 3, 7, 6, 4, 6, 8, 2])[0]
            doc = r.choice(DOCTORS)
            others = r.sample([d for d in DOCTORS if d[1] != doc[1]], 3)
            same = [d for d in DOCTORS if d[1] == doc[1] and d != doc]
            if kind == "book_spec_dup" and not same:
                kind = "book_spec_one"
            day_p, day = c.day(r)
            h, m = r.choice([(8, 0), (8, 30), (9, 0), (10, 30), (14, 0), (15, 30), (17, 0), (18, 30)])
            docs = [doc] + (same[:1] if kind == "book_spec_dup" else []) + others
            state = []
            for k, (dname, spec, clinic, _) in enumerate(docs):
                slots = sorted({slot(day, hh, mm) for hh, mm in [(8, 0), (9, 0), (10, 30), (14, 0), (16, 0), (17, 30)] if r.random() < 0.5}
                               | ({slot(day, h, m)} if k == 0 and kind != "cond_no" else set()))
                state.append({"id": f"dr_{k + 1:02d}", "name": f"BS. {dname}", "specialty": spec, "clinic": clinic, "available_slots": slots})
            st = {"clinic": {"doctors": state, "appointments": []}}
            me = r.choice(ME)
            given = doc[0].split()[-1]
            if any(fold(given) in fold(d[0] + " " + d[2]) for d in docs[1:]):
                given = doc[0]
            t_p = hour_text(r, h, m)
            when = r.choice([f"{t_p} {day_p}", f"{day_p} lúc {t_p}"])
            reason = r.choice(REASONS[doc[1]])
            by_name = C("clinic.search_doctors", query=r.choice([doc[0], given]))
            q = by_name["arguments"]["query"]
            book = C("clinic.book_appointment", doctor_id="dr_01", time=iso(day, h, m), reason=reason)
            if kind == "book_name":
                text = r.choice([f"Đặt lịch {doc[3]} với bác sĩ {q} {when} cho {me}, {reason}.",
                                 f"{me.capitalize()} muốn hẹn bác sĩ {q} {when}, {reason}, em đặt giúp nhé.",
                                 f"Book bác sĩ {q} {when} nha, lý do là {reason}."])
                gold = [by_name, book]
            elif kind in ("book_spec_dup", "book_spec_one"):
                text = r.choice([f"Đặt lịch {doc[3]} {when} giúp {me}, {reason}.", f"{me.capitalize()} cần {doc[3]} {when}, {reason}, đặt giùm nha."])
                gold = [C("clinic.search_doctors", specialty=doc[1])]
                gold.append(ASK("clinic.book_appointment", "doctor_id") if kind == "book_spec_dup" else book)
            elif kind == "missing_time":
                text = r.choice([f"Đặt lịch khám với bác sĩ {q} giúp {me}, {reason}.", f"Hẹn bác sĩ {q} {day_p} cho {me} nhé, {reason}."])
                gold = [ASK("clinic.book_appointment", "time")]
            elif kind == "cond_no":
                text = f"Bác sĩ {q} {when} còn trống thì đặt cho {me}, không thì thôi để tuần sau."
                gold = [by_name]
            elif kind == "check":
                text = r.choice([f"Bác sĩ {q} {day_p} còn trống giờ nào em?", f"Coi lịch trống của bác sĩ {q} giùm {me}."])
                gold = [by_name]
            elif kind in ("cancel", "resched"):
                old = slot(day, 9)
                state[0]["available_slots"] = sorted(set(state[0]["available_slots"]) - {old})
                st["clinic"]["appointments"] = [{"id": "apt_01", "doctor_id": "dr_01", "time": old + ":00+07:00", "patient": "self",
                                                 "reason": reason, "status": "booked"},
                                                {"id": "apt_02", "doctor_id": "dr_02", "time": iso(day + dt.timedelta(days=3), 15),
                                                 "patient": "self", "reason": "tái khám", "status": "booked"}]
                if kind == "cancel":
                    text = r.choice([f"Hủy lịch khám bác sĩ {q} {day_p} giúp {me}.", f"{me.capitalize()} khỏi rồi, huỷ lịch hẹn bác sĩ {q} nha."])
                    gold = [C("clinic.list_appointments"), C("clinic.cancel_appointment", appointment_id="apt_01")]
                else:
                    if (h, m) == (9, 0):
                        h, m = 10, 30
                        state[0]["available_slots"] = sorted(set(state[0]["available_slots"]) | {slot(day, h, m)})
                    text = r.choice([f"Lịch khám bác sĩ {q} {day_p} dời sang {hour_text(r, h, m)} giúp {me}.",
                                     f"Đổi giờ hẹn bác sĩ {q} thành {hour_text(r, h, m)} nhé."])
                    gold = [C("clinic.list_appointments"), C("clinic.reschedule", appointment_id="apt_01", time=iso(day, h, m))]
            elif kind == "retract":
                text = f"Đặt lịch {doc[3]} {when} cho {me}... thôi khỏi, để {me} gọi thẳng phòng khám."
                gold = []
            elif kind == "book_remind":
                st["reminders"] = {"reminders": []}
                at = dt.datetime.combine(day, dt.time(h, m)) - dt.timedelta(hours=1)
                text = f"Đặt lịch bác sĩ {q} {when}, {reason}, rồi nhắc {me} trước một tiếng nhé."
                gold = [by_name, book, C("reminders.create", content="đi khám bác sĩ " + q, time=iso(at.date(), at.hour, at.minute))]
            else:  # hist_direct
                found = {"ok": True, "doctors": [state[0]]}
                hist = [{"role": "user", "text": f"Bác sĩ {q} {day_p} có lịch trống không em?"},
                        {"role": "assistant", "text": f"BS. {doc[0]} còn trống {len(state[0]['available_slots'])} khung giờ {day_p}.",
                         "tool_calls": [by_name], "tool_results": [found]}]
                text = r.choice([f"Ừ đặt {t_p} cho {me}, {reason}.", f"Vậy lấy giờ {t_p} đi em, {reason}."])
                self.add("cli_" + kind, c, text, [book], st, history=hist)
                continue
            self.add("cli_" + kind, c, text, gold, st)

    # -- hotel_booking ------------------------------------------------------------------------------------------------------
    def hotel_tasks(self, count: int):
        r = self.rng
        for _ in range(count):
            c = self.clock()
            kind = r.choices(["book", "missing", "cancel", "change", "cond_no", "retract", "book_sms", "hist_direct", "dup"],
                             [18, 8, 7, 6, 5, 4, 6, 8, 5])[0]
            picks = r.sample(HOTELS, 4)
            name, city = picks[0]
            hotels = []
            for k, (hn, hc) in enumerate(picks):
                rooms = {rt: r.randint(0, 3) for rt in ROOM}
                hotels.append({"id": f"h_{k + 1:02d}", "name": f"Khách sạn {hn}" if r.random() < 0.5 else hn, "city": hc,
                               "address": f"{r.randint(1, 200)} {r.choice(['Trần Phú', 'Hùng Vương', 'Lê Lợi', 'Nguyễn Huệ'])}, {hc}",
                               "price_per_night": r.choice([650000, 850000, 1200000, 1450000, 2100000]), "rating": round(r.uniform(3.8, 4.9), 1),
                               "rooms": rooms})
            if kind == "dup":
                twin = copy.deepcopy(hotels[0])
                twin.update(id="h_05", address=f"{r.randint(1, 200)} Bãi Trước, {city}")
                hotels.append(twin)
            rt = r.choice(list(ROOM))
            hotels[0]["rooms"][rt] = 0 if kind == "cond_no" else max(1, hotels[0]["rooms"][rt])
            d_in_p, d_in = c.day(r, 2)
            nights = r.choice([1, 2, 3])
            d_out = d_in + dt.timedelta(days=nights)
            guests = r.randint(1, 5)
            me = r.choice(ME)
            st = {"hotel_booking": {"hotels": hotels, "bookings": []}}
            stay = r.choice([f"nhận phòng {d_in_p}, ở {words(nights)} đêm", f"từ {d_in_p} ở {words(nights)} đêm",
                             f"{d_in_p} nhận phòng, ngày {words(d_out.day)} trả"])
            g = r.choice([f"{words(guests)} người", f"{guests} khách"])
            search = C("hotel_booking.search_hotels", query=name) if r.random() < 0.6 else C("hotel_booking.search_hotels", city=city, query=name)
            book = C("hotel_booking.book", hotel_id="h_01", room_type=rt, check_in=d_in.isoformat(), check_out=d_out.isoformat(), guests=guests)
            room = r.choice(ROOM[rt])
            if kind in ("book", "dup"):
                text = r.choice([f"Đặt giúp {me} một {room} ở {name} {city}, {stay}, {g} nhé.",
                                 f"Book {room} khách sạn {name} ở {city} cho {g}, {stay}.",
                                 f"{me.capitalize()} đi {city}, em đặt {room} ở {name}, {stay}, {g} nha."])
                gold = [search, ASK("hotel_booking.book", "hotel_id") if kind == "dup" else book]
            elif kind == "missing":
                which = r.choice(["guests", "check_in"])
                text = (f"Đặt {room} ở {name} {city}, {stay} giúp {me}." if which == "guests" else
                        f"Đặt cho {me} {room} ở {name} {city}, {g} nhé.")
                gold = [ASK("hotel_booking.book", *(["guests"] if which == "guests" else ["check_in", "check_out"]))]
            elif kind == "cond_no":
                text = f"Xem {name} ở {city} còn {room} không, còn thì đặt {stay} cho {g}, hết thì thôi."
                gold = [search]
            elif kind in ("cancel", "change"):
                st["hotel_booking"]["bookings"] = [{"id": "bk_01", "hotel_id": "h_01", "room_type": rt, "check_in": d_in.isoformat(),
                                                    "check_out": d_out.isoformat(), "guests": guests, "status": "confirmed"}]
                if kind == "cancel":
                    text = r.choice([f"Hủy đặt phòng {name} {city} giúp {me}.", f"Chuyến {city} hoãn rồi, huỷ phòng khách sạn đi em."])
                    gold = [C("hotel_booking.list_bookings"), C("hotel_booking.cancel_booking", booking_id="bk_01")]
                else:
                    sh = r.choice([1, 2])
                    n_in, n_out = d_in + dt.timedelta(days=sh), d_out + dt.timedelta(days=sh)
                    text = f"Phòng ở {name} lùi lại {words(sh)} ngày giúp {me}, nhận ngày {words(n_in.day)} trả ngày {words(n_out.day)}."
                    gold = [C("hotel_booking.list_bookings"),
                            C("hotel_booking.change_dates", booking_id="bk_01", check_in=n_in.isoformat(), check_out=n_out.isoformat())]
            elif kind == "retract":
                text = f"Đặt {room} ở {name} {stay}... à thôi, chờ {me} chốt lịch nghỉ phép đã."
                gold = []
            elif kind == "book_sms":
                who = r.choice(CONTACT_POOL)[0]
                st["contacts"] = contacts_state(r, [who])
                st["sms"] = {"messages": []}
                msg = f"đã đặt phòng {name} {city} {d_in_p}"
                text = f"Đặt {room} ở {name} {city}, {stay}, {g}, rồi nhắn {spoken_contact(who)} là {msg} nhé."
                gold = [search, book, C("contacts.search", query=who), C("sms.send", contact_id=contact_id(st["contacts"], who), content=msg)]
            else:  # hist_direct
                found = {"ok": True, "hotels": [hotels[0]]}
                hist = [{"role": "user", "text": f"Ở {city} khách sạn {name} giá bao nhiêu một đêm em?"},
                        {"role": "assistant", "text": f"{hotels[0]['name']} giá {hotels[0]['price_per_night']:,} đồng một đêm.".replace(",", "."),
                         "tool_calls": [search], "tool_results": [found]}]
                text = r.choice([f"Được, đặt {room} ở đó luôn, {stay}, {g}.", f"Ừ lấy khách sạn đó đi, {room}, {stay}, {g} nha."])
                self.add("htl_" + kind, c, text, [book], st, history=hist)
                continue
            self.add("htl_" + kind, c, text, gold, st)

    # -- charity ------------------------------------------------------------------------------------------------------------
    def charity_tasks(self, count: int):
        r = self.rng
        for _ in range(count):
            c = self.clock()
            kind = r.choices(["donate", "monthly", "missing", "dup", "stop", "retract", "hist_direct", "check"], [14, 5, 8, 6, 5, 3, 7, 1])[0]
            picks = r.sample(CAMPAIGNS, 4)
            camps = [{"id": f"cp_{k + 1:02d}", "title": t, "topic": tp, "organizer": org, "goal": r.choice([50, 100, 200]) * 1000000,
                      "raised": r.randint(5, 40) * 1000000} for k, (t, tp, org) in enumerate(picks)]
            if kind == "dup":
                twin = copy.deepcopy(camps[0])
                twin.update(id="cp_05", organizer=r.choice(["Quỹ Thiện Tâm", "Nhóm Tình Nguyện Xanh"]))
                camps.append(twin)
            st = {"charity": {"campaigns": camps, "donations": []}}
            amt, amt_p = r.choice(AMOUNTS)
            me = r.choice(ME)
            title = picks[0][0]
            key = r.choice([title, CAMPAIGN_SHORT[title]])
            find = C("charity.list_campaigns", query=key)
            give = C("charity.donate", campaign_id="cp_01", amount=amt)
            if kind in ("donate", "dup", "monthly"):
                text = r.choice([f"Ủng hộ {amt_p} cho chương trình {key} giúp {me}.", f"{me.capitalize()} muốn góp {amt_p} vào quỹ {key}.",
                                 f"Chuyển {amt_p} ủng hộ {key} nha em."])
                if kind == "monthly":
                    text = text.rstrip(".") + ", mỗi tháng đều đặn nhé."
                    give["arguments"]["monthly"] = True
                elif r.random() < 0.25:
                    text = text.rstrip(".") + ", ẩn danh nha."
                    give["arguments"]["anonymous"] = True
                gold = [find, ASK("charity.donate", "campaign_id") if kind == "dup" else give]
            elif kind == "missing":
                text = r.choice([f"Ủng hộ chương trình {key} giúp {me} với.", f"{me.capitalize()} muốn góp tiền cho {key}, em làm giúp nhé."])
                gold = [ASK("charity.donate", "amount")]
            elif kind == "check":
                text = f"Chương trình {key} quyên góp được bao nhiêu rồi em?"
                gold = [find]
            elif kind == "stop":
                st["charity"]["donations"] = [{"id": "don_01", "campaign_id": "cp_01", "amount": amt, "monthly": True, "anonymous": False, "active": True}]
                text = r.choice([f"Dừng khoản ủng hộ hằng tháng cho {key} giúp {me}.", f"Thôi không góp hàng tháng cho quỹ {key} nữa, ngưng giúp {me}."])
                gold = [C("charity.list_donations"), C("charity.stop_monthly", donation_id="don_01")]
            elif kind == "retract":
                text = f"Ủng hộ {amt_p} cho {key}... à để cuối tháng nhận lương đã, khoan làm."
                gold = []
            else:
                hist = [{"role": "user", "text": f"Tìm chương trình {key} giúp {me}."},
                        {"role": "assistant", "text": f"Có chương trình {camps[0]['title']} của {camps[0]['organizer']}.",
                         "tool_calls": [find], "tool_results": [{"ok": True, "campaigns": [x for x in camps if key.lower() in x["title"].lower()]}]}]
                text = r.choice([f"Ừ góp {amt_p} vào đó giúp {me}.", f"Vậy ủng hộ {amt_p} nha em."])
                self.add("cha_" + kind, c, text, [give], st, history=hist)
                continue
            self.add("cha_" + kind, c, text, gold, st)

    # -- sports_court -------------------------------------------------------------------------------------------------------
    def court_tasks(self, count: int):
        r = self.rng
        for _ in range(count):
            c = self.clock()
            kind = r.choices(["book", "cond_no", "missing", "cancel", "retract", "book_sms", "check"], [18, 3, 6, 6, 3, 6, 2])[0]
            court = r.choice(COURTS)
            same = [x for x in COURTS if x[1] == court[1] and x != court]
            others = r.sample([x for x in COURTS if x[1] != court[1]], 2)
            day_p, day = c.day(r)
            h = r.choice([6, 7, 17, 18, 19, 20])
            hours = r.choice([1, 2])
            courts = []
            for k, (cn, sp, _, price) in enumerate([court] + same[:1] + others):
                free = sorted({f"{x:02d}:00" for x in range(6, 22) if r.random() < 0.5} |
                              ({f"{h + i:02d}:00" for i in range(hours)} if k == 0 and kind != "cond_no" else set()))
                if k == 0 and kind == "cond_no":
                    free = [x for x in free if x != f"{h:02d}:00"]
                courts.append({"id": f"ct_{k + 1:02d}", "name": cn, "sport": sp, "address": r.choice(["Thanh Xuân", "Quận 7", "Cầu Giấy", "Bình Thạnh"]),
                               "price_per_hour": price, "slots": {day.isoformat(): free}})
            st = {"sports_court": {"courts": courts, "bookings": []}}
            me = r.choice(ME)
            span = (f"từ {hour_text(r, h)} tới {hour_text(r, h + hours)}" if r.random() < 0.5 else f"{hour_text(r, h)}, {words(hours)} tiếng")
            short = court[0].replace("Sân cầu lông ", "sân ").replace("Sân bóng ", "sân ").replace("Sân tennis ", "sân ").replace("Sân pickleball ", "sân ")
            search = C("sports_court.search_courts", sport=court[1], date=day.isoformat())
            book = C("sports_court.book_court", court_id="ct_01", date=day.isoformat(), start_time=f"{h:02d}:00", hours=hours)
            if kind == "book":
                text = r.choice([f"Đặt {short} chơi {court[2]} {day_p} {span} giúp {me}.", f"{day_p.capitalize()} {me} muốn đánh {court[2]} ở {short}, {span}, em book nhé."])
                gold = [search, book]
            elif kind == "cond_no":
                text = f"Nếu {short} {day_p} còn trống {hour_text(r, h)} thì đặt {words(hours)} tiếng cho {me}."
                gold = [search]
            elif kind == "check":
                text = f"{day_p.capitalize()} {short} còn trống giờ nào em?"
                gold = [search]
            elif kind == "missing":
                text = f"Đặt {short} {day_p} giúp {me}, chơi {court[2]}."
                gold = [ASK("sports_court.book_court", "start_time", "hours")]
            elif kind == "cancel":
                st["sports_court"]["bookings"] = [{"id": "cb_01", "court_id": "ct_01", "date": day.isoformat(), "start_time": f"{h:02d}:00",
                                                   "hours": hours, "total": court[3] * hours, "status": "booked"}]
                text = r.choice([f"Hủy sân {court[2]} {day_p} giúp {me}, team bận rồi.", f"Huỷ lượt đặt {short} {day_p} nha em."])
                gold = [C("sports_court.list_bookings"), C("sports_court.cancel_booking", booking_id="cb_01")]
            elif kind == "retract":
                text = f"Book {short} {day_p} {span}... à thôi, để {me} hỏi anh em trước đã."
                gold = []
            else:
                who = r.choice(CONTACT_POOL)[0]
                st["contacts"] = contacts_state(r, [who])
                st["sms"] = {"messages": []}
                msg = f"{day_p} {hour_text(r, h)} đánh {court[2]} ở {short}"
                text = f"Đặt {short} {day_p} {span}, xong nhắn {spoken_contact(who)} là {msg} nhé."
                gold = [search, book, C("contacts.search", query=who), C("sms.send", contact_id=contact_id(st["contacts"], who), content=msg)]
            self.add("crt_" + kind, c, text, gold, st)

    # -- writes that need no ID (TRAIN: a third of the writes start without a read) ------------------------------------------
    def direct_tasks(self, count: int):
        r = self.rng
        goals = [("Mua laptop mới", 25000000, "hai mươi lăm triệu"), ("Du lịch Đà Lạt", 8000000, "tám triệu"), ("Quỹ khẩn cấp", 30000000, "ba mươi triệu"),
                 ("Mua xe đạp cho con", 4000000, "bốn triệu"), ("Sửa nhà", 50000000, "năm mươi triệu"), ("Học tiếng Anh", 12000000, "mười hai triệu")]
        for _ in range(count):
            c = self.clock()
            me = r.choice(ME)
            kind = r.choice(["lock", "unlock", "climate", "climate_missing", "honk", "goal", "goal_deadline", "album", "guest_on", "guest_off",
                             "wifi_pass", "climate_remind"])
            car = {"car": {"model": r.choice(["VinFast VF 6", "VinFast VF 8", "Kia Seltos"]), "locked": kind == "unlock",
                           "cabin_temp_c": r.randint(28, 38), "battery_percent": r.randint(30, 95), "location": r.choice(["Hầm B2", "Bãi xe công ty"]),
                           "climate": {"on": False}}}
            if kind in ("lock", "unlock"):
                text = r.choice([f"Khóa xe giúp {me} với, quên bấm khóa rồi.", f"Em khoá cửa xe lại giùm {me}."] if kind == "lock" else
                                [f"Mở khóa xe cho {me}, {me} sắp xuống tới.", f"Mở cửa xe giúp {me} nha."])
                gold, st = [C("car_remote.lock", locked=kind == "lock")], {"car_remote": car}
            elif kind in ("climate", "climate_remind"):
                tmp, mins = r.choice([22, 23, 24, 25, 26]), r.choice([10, 15, 20])
                text = r.choice([f"Bật điều hòa xe {words(tmp)} độ trước {words(mins)} phút giúp {me}.",
                                 f"Làm mát xe trước đi em, để {tmp} độ, chạy {words(mins)} phút."])
                gold, st = [C("car_remote.climate_start", temperature=tmp, minutes=mins)], {"car_remote": car}
                if kind == "climate_remind":
                    st["reminders"] = {"reminders": []}
                    h, m = r.choice([(17, 30), (18, 0), (7, 15)])
                    day = c.today + dt.timedelta(days=1 if c.now.hour >= h else 0)
                    text = text.rstrip(".") + f", rồi {hour_text(r, h, m)} nhắc {me} {r.choice(['mang áo mưa', 'ghé đổ xăng', 'đón con'])}."
                    gold.append(C("reminders.create", content=text.rsplit(" nhắc " + me + " ", 1)[1].rstrip("."), time=iso(day, h, m)))
            elif kind == "climate_missing":
                text = r.choice([f"Bật máy lạnh xe trước giùm {me}.", f"Mở điều hòa xe sẵn cho {me} nhé."])
                gold, st = [ASK("car_remote.climate_start", "temperature")], {"car_remote": car}
            elif kind == "honk":
                mode = r.choice(["both", "flash"])
                text = (f"Bấm còi nháy đèn xe giúp {me}, không biết đỗ chỗ nào." if mode == "both" else
                        f"Nháy đèn xe thôi đừng bấm còi nha, {me} tìm xe trong hầm.")
                gold, st = [C("car_remote.honk_flash", mode=mode)], {"car_remote": car}
            elif kind in ("goal", "goal_deadline"):
                name, target, target_p = r.choice(goals)
                st = {"savings_goals": {"goals": []}}
                text = f"Tạo mục tiêu tiết kiệm {name.lower()} {target_p} giúp {me}"
                gold = [C("savings_goals.create_goal", name=name, target=target)]
                if kind == "goal_deadline":
                    d = dt.date(c.today.year + 1, r.choice([3, 6, 9, 12]), 1)
                    text += f", hạn ngày một tháng {words(d.month)} năm sau"
                    gold[0]["arguments"]["deadline"] = d.isoformat()
                text += "."
            elif kind == "album":
                ev = r.choice(["Sinh nhật bé Na", "Du lịch Hội An", "Họp lớp", "Đám cưới chị Hà", "Tết Dương lịch"])
                d1 = c.today - dt.timedelta(days=r.randint(3, 20))
                d2 = d1 + dt.timedelta(days=r.choice([0, 1, 2]))
                st = {"photo_album": {"albums": [], "photos": [{"id": f"ph_{k:02d}", "date": (d1 + dt.timedelta(days=k % 3)).isoformat()} for k in range(1, 7)]}}
                span = f"ngày {words(d1.day)} tháng {words(d1.month)}" if d1 == d2 else f"từ ngày {words(d1.day)} đến ngày {words(d2.day)} tháng {words(d2.month)}"
                text = f"Gom ảnh {span} thành album {ev} giúp {me}."
                gold = [C("photo_album.create_album", title=ev, date_from=d1.isoformat(), date_to=d2.isoformat())]
            elif kind in ("guest_on", "guest_off"):
                st = {"wifi_router": {"network": {"ssid": "NhaMinh", "guest_enabled": kind == "guest_off", "password": "x"}, "devices": [], "schedules": []}}
                if kind == "guest_on":
                    pw = r.choice(["khach2026", "chaomung123", "nhaminh88"])
                    text = f"Bật wifi khách lên, mật khẩu là {pw} nha em."
                    gold = [C("wifi_router.set_guest_network", enabled=True, password=pw)]
                else:
                    text = f"Tắt mạng wifi khách đi em, khách về rồi."
                    gold = [C("wifi_router.set_guest_network", enabled=False)]
            else:
                pw = r.choice(["matkhaumoi2026", "baove@123", "nhaminh2027"])
                st = {"wifi_router": {"network": {"ssid": "NhaMinh", "guest_enabled": False, "password": "x"}, "devices": [], "schedules": []}}
                text = f"Đổi mật khẩu wifi nhà thành {pw} giúp {me}."
                gold = [C("wifi_router.change_password", new_password=pw)]
            self.add("dir_" + kind, c, text, gold, st)

    # -- small talk / out of reach: empty gold (TRAIN 7%) -------------------------------------------------------------------
    def chat_tasks(self, count: int):
        r = self.rng
        lines = ["Chào buổi sáng nha, hôm nay em khỏe không?", "Cảm ơn em nhiều nhé, vậy là ổn rồi.", "Ờ để anh suy nghĩ thêm đã.",
                 "Thôi khỏi, chị tự làm cũng được.", "Hôm nay mệt quá trời luôn á.", "Ừ, vậy được rồi, không cần làm gì thêm đâu.",
                 "Em kể chuyện gì vui nghe coi.", "Tuần này bận dữ ha.", "Ok em, để mai tính tiếp nha.", "À không có gì, chị bấm nhầm thôi."]
        for _ in range(count):
            c = self.clock()
            st = {"restaurant_booking": {"restaurants": self.restaurants(c, c.today + dt.timedelta(days=1), 19, 0, r.sample(RESTAURANTS, 3)),
                                         "reservations": []}}
            self.add("chat", c, r.choice(lines), [], st)


def build() -> list[dict]:
    g = Gen()
    g.restaurant_tasks(150)
    g.clinic_tasks(110)
    g.hotel_tasks(90)
    g.charity_tasks(60)
    g.court_tasks(70)
    g.direct_tasks(110)
    g.chat_tasks(15)
    return g.tasks


TASKS = build()
