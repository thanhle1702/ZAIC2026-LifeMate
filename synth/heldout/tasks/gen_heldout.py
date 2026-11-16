"""Held-out evaluation tasks on four apps no adapter was trained on (synth/heldout/heldout_apps.py): gym_booking, pharmacy,
bike_rental, parcel_locker, plus cross-app steps on TRAIN apps (contacts, sms, reminders).

Same TRAIN conventions as synth/tasks/gen_v2.py (read before a write on an entity named in words; a missing VALUE is asked at
once; an ambiguous entity is read, then its ID is asked; an ID seen in the history is used directly; retractions end empty).
Use: scripts/data/build_synth_split.py --apps synth/heldout/heldout_apps.py --catalog synth/heldout/heldout_catalog.py
--tasks synth/heldout/tasks --out outputs/heldout. Evaluation only: never add these to training data."""
from __future__ import annotations

import datetime as dt
import random

from _common import ASK, C, T
from gen_v2 import CONTACT_POOL, ME, NOWS, Clock, contact_id, contacts_state, hour_text, iso, spoken_contact, words

CLASSES = [("Yoga", "yoga", "HLV Minh Thư"), ("Pilates", "pilates", "HLV Hoài An"), ("Boxing", "boxing", "HLV Đức Long"),
           ("Zumba", "zumba", "HLV Kiều Trang"), ("Bơi người lớn", "bơi", "HLV Quốc Bảo"), ("Gym cơ bản", "gym cơ bản", "HLV Thành Đạt"),
           ("Aerobic", "aerobic", "HLV Phương Linh"), ("Kickfit", "kickfit", "HLV Gia Huy")]
STUDIOS = ["CitiGym Trần Duy Hưng", "Elite Fitness Nguyễn Du", "California Quận 7", "Swequity Thảo Điền"]
PRODUCTS = [("Panadol Extra", "panadol", "hạ sốt giảm đau", "hộp"), ("Efferalgan 500mg", "efferalgan", "hạ sốt", "hộp"),
            ("Vitamin C 1000", "vitamin c", "tăng đề kháng", "lọ"), ("Siro ho Prospan", "siro ho", "trị ho", "chai"),
            ("Khẩu trang y tế 4 lớp", "khẩu trang", "phòng bụi", "hộp"), ("Nước muối sinh lý", "nước muối", "súc họng rửa mũi", "chai"),
            ("Oresol cam", "oresol", "bù nước điện giải", "hộp"), ("Men vi sinh Biogaia", "men vi sinh", "tiêu hoá", "lọ"),
            ("Băng cá nhân Urgo", "băng cá nhân", "vết thương nhỏ", "hộp"), ("Kem chống nắng La Roche", "kem chống nắng", "chống nắng", "tuýp")]
TWINS = {"panadol": "Panadol Cảm cúm", "vitamin c": "Vitamin C sủi Plusssz", "siro ho": "Siro ho Bảo Thanh", "khẩu trang": "Khẩu trang N95"}
STATIONS = [("Nhà hát Lớn", "1 Tràng Tiền, Hoàn Kiếm"), ("Hồ Gươm", "Đinh Tiên Hoàng, Hoàn Kiếm"), ("Công viên Thống Nhất", "Trần Nhân Tông, Hai Bà Trưng"),
            ("Ga Hà Nội", "120 Lê Duẩn, Đống Đa"), ("Hồ Tây", "Thanh Niên, Tây Hồ"), ("Văn Miếu", "58 Quốc Tử Giám, Đống Đa"),
            ("Chợ Bến Thành", "Lê Lợi, Quận 1"), ("Nhà thờ Đức Bà", "1 Công xã Paris, Quận 1"), ("Phố đi bộ Nguyễn Huệ", "Nguyễn Huệ, Quận 1")]
BIKE_WORDS = {"classic": ["xe đạp thường", "xe đạp", "xe thường"], "electric": ["xe đạp điện", "xe điện"]}
SENDERS = [("Shopee", "shopee"), ("Lazada", "lazada"), ("Tiki", "tiki"), ("Thế Giới Di Động", "thế giới di động"), ("Uniqlo", "uniqlo"),
           ("Fahasa", "fahasa"), ("Hasaki", "hasaki"), ("Bách Hoá Xanh", "bách hoá xanh")]
ADDRESSES = [("số 5 ngõ 12 Láng Hạ", "số 5 ngõ 12 Láng Hạ"), ("công ty, 72 Lê Thánh Tôn", "72 Lê Thánh Tôn"),
             ("nhà mẹ ở 18 Phan Chu Trinh", "18 Phan Chu Trinh"), ("toà Landmark 81 tầng 12", "Landmark 81 tầng 12")]


class Held:
    def __init__(self, seed: int = 101):
        self.rng = random.Random(seed)
        self.tasks: list[dict] = []
        self.n = 0

    def add(self, kind, clock, text, gold, states, **extra):
        self.n += 1
        self.tasks.append(T(f"ho_{kind}_{self.n:03d}", clock.stamp, text, gold, states, **extra))

    def clock(self):
        return Clock(self.rng.choice(NOWS))

    # -- gym_booking ------------------------------------------------------------------------------------------------------------
    def gym(self, count):
        r = self.rng
        for _ in range(count):
            c = self.clock()
            kind = r.choices(["book", "dup", "full", "cancel", "book_remind", "hist_direct", "retract", "note"], [14, 6, 4, 7, 5, 5, 3, 4])[0]
            picks = r.sample(CLASSES, 4)
            name, kw, trainer = picks[0]
            day_p, day = c.day(r)
            h, m = r.choice([(6, 0), (6, 30), (7, 0), (17, 30), (18, 0), (19, 0), (20, 0)])
            studio = r.choice(STUDIOS)
            classes = []
            for k, (nm, _, tr) in enumerate(picks):
                hh, mm = (h, m) if k == 0 else r.choice([(6, 0), (9, 0), (12, 0), (17, 0), (18, 30), (20, 30)])
                classes.append({"id": f"cls_{k + 1:02d}", "name": nm, "trainer": tr, "studio": studio, "start": iso(day, hh, mm),
                                "spots_left": 0 if (k == 0 and kind == "full") else r.randint(2, 12)})
            if kind == "dup":
                h2 = 19 if h < 12 else 7
                classes.insert(1, {"id": f"cls_{len(classes) + 1:02d}", "name": name, "trainer": r.choice(CLASSES)[2], "studio": studio,
                                   "start": iso(day, h2), "spots_left": 5})
            st = {"gym_booking": {"classes": classes, "bookings": []}}
            me = r.choice(ME)
            t_p = hour_text(r, h, m)
            search = C("gym_booking.search_classes", date=day.isoformat(), query=kw)
            book = C("gym_booking.book_class", class_id="cls_01")
            if kind in ("book", "full", "note"):
                text = r.choice([f"Đăng ký giúp {me} lớp {kw} {t_p} {day_p} nhé.", f"{day_p.capitalize()} {me} muốn tập {kw} lúc {t_p}, giữ chỗ giùm {me}.",
                                 f"Book cho {me} một suất lớp {kw} {day_p}, ca {t_p}."])
                gold = [search, book] if kind != "full" else [search]
                if kind == "note":
                    note = r.choice(["mới tập lần đầu", "bị đau lưng nhẹ", "cần mượn thảm"])
                    text = text.rstrip(".") + f", nhắn huấn luyện viên là {me} {note}."
                    book["arguments"]["note"] = note
            elif kind == "dup":
                text = r.choice([f"Đặt giúp {me} lớp {kw} {day_p} nhé.", f"{day_p.capitalize()} cho {me} đi tập {kw}, em đăng ký đi."])
                gold = [search, ASK("gym_booking.book_class", "class_id")]
            elif kind == "cancel":
                st["gym_booking"]["bookings"] = [{"id": "gb_01", "class_id": "cls_01", "start": iso(day, h, m), "status": "booked"},
                                                 {"id": "gb_02", "class_id": "cls_02", "start": classes[1]["start"], "status": "booked"}]
                text = r.choice([f"Huỷ lớp {kw} {day_p} của {me} đi, {me} bận rồi.", f"{day_p.capitalize()} {me} không đi tập {kw} được, huỷ giúp {me}."])
                gold = [C("gym_booking.my_bookings"), C("gym_booking.cancel_booking", booking_id="gb_01")]
            elif kind == "book_remind":
                st["reminders"] = {"reminders": []}
                text = f"Đặt lớp {kw} {t_p} {day_p} cho {me}, rồi nhắc {me} trước một tiếng để chuẩn bị đồ nhé."
                at = dt.datetime.combine(day, dt.time(h, m)) - dt.timedelta(hours=1)
                gold = [search, book, C("reminders.create", content=f"đi tập {kw}", time=iso(at.date(), at.hour, at.minute))]
            elif kind == "hist_direct":
                hist = [{"role": "user", "text": f"{day_p.capitalize()} có lớp {kw} nào không em?"},
                        {"role": "assistant", "text": f"Có lớp {name} lúc {classes[0]['start'][11:16]} với {trainer}, còn {classes[0]['spots_left']} chỗ.",
                         "tool_calls": [search], "tool_results": [{"ok": True, "classes": [classes[0]]}]}]
                text = r.choice([f"Ừ đăng ký lớp đó cho {me} luôn.", f"Vậy giữ chỗ lớp đó giúp {me} nhé."])
                self.add("gym_" + kind, c, text, [book], st, history=hist)
                continue
            else:
                text = f"Đặt lớp {kw} {day_p} giúp {me}... à thôi, để {me} xem lịch đã."
                gold = []
            self.add("gym_" + kind, c, text, gold, st)

    # -- pharmacy ---------------------------------------------------------------------------------------------------------------
    def pharmacy(self, count):
        r = self.rng
        for _ in range(count):
            c = self.clock()
            kind = r.choices(["order", "missing_qty", "dup", "cancel", "refill", "order_sms", "check", "retract"], [14, 6, 6, 6, 5, 5, 3, 3])[0]
            picks = r.sample(PRODUCTS, 4)
            if kind == "dup":
                picks[0] = r.choice([p for p in PRODUCTS if p[1] in TWINS])
                picks[1:] = [p for p in r.sample(PRODUCTS, 5) if p[1] != picks[0][1]][:3]
            name, kw, use, unit = picks[0]
            prods = [{"id": f"pr_{k + 1:02d}", "name": nm, "use": u, "unit": un, "price": r.choice([25000, 45000, 68000, 120000]), "stock": r.randint(5, 30)}
                     for k, (nm, _, u, un) in enumerate(picks)]
            if kind == "dup":
                prods.insert(1, {"id": f"pr_{len(prods) + 1:02d}", "name": TWINS[kw], "use": use, "unit": unit, "price": 55000, "stock": 12})
            st = {"pharmacy": {"products": prods, "orders": [], "refills": []}}
            me = r.choice(ME)
            q = r.randint(1, 4)
            qty = r.choice([f"{words(q)} {unit}", f"{q} {unit}"])
            search = C("pharmacy.search_products", query=kw)
            order = C("pharmacy.order", product_id="pr_01", quantity=q)
            if kind == "order":
                text = r.choice([f"Mua giúp {me} {qty} {kw} nhé.", f"Đặt {qty} {kw} giao về nhà cho {me}.", f"Em order {qty} {kw} giùm {me} với."])
                gold = [search, order]
            elif kind == "missing_qty":
                text = r.choice([f"Mua {kw} cho {me} nhé.", f"Đặt giúp {me} ít {kw} giao về nhà."])
                gold = [ASK("pharmacy.order", "quantity")]
            elif kind == "dup":
                text = f"Đặt {qty} {kw} cho {me} nhé."
                gold = [search, ASK("pharmacy.order", "product_id")]
            elif kind == "cancel":
                st["pharmacy"]["orders"] = [{"id": "ph_01", "product_id": "pr_01", "quantity": q, "status": "placed"},
                                            {"id": "ph_02", "product_id": "pr_02", "quantity": 1, "status": "placed"}]
                text = r.choice([f"Huỷ đơn {kw} hồi nãy giúp {me}, {me} mua ngoài rồi.", f"Không cần {kw} nữa, huỷ đơn đó đi em."])
                gold = [C("pharmacy.list_orders"), C("pharmacy.cancel_order", order_id="ph_01")]
            elif kind == "refill":
                d = r.choice([7, 10, 14, 30])
                text = r.choice([f"Cứ {words(d)} ngày nhắc {me} mua lại {kw} nhé.", f"Hẹn nhắc mua lại {kw} mỗi {d} ngày cho {me}."])
                gold = [search, C("pharmacy.set_refill_reminder", product_id="pr_01", every_days=d)]
            elif kind == "order_sms":
                who = r.choice(CONTACT_POOL)[0]
                st["contacts"] = contacts_state(r, [who])
                st["sms"] = {"messages": []}
                msg = r.choice([f"đã đặt {kw} rồi nhé", f"{kw} đang giao về nhà"])
                text = f"Đặt {qty} {kw}, xong nhắn {spoken_contact(who)} là {msg}."
                gold = [search, order, C("contacts.search", query=who), C("sms.send", contact_id=contact_id(st["contacts"], who), content=msg)]
            elif kind == "check":
                text = r.choice([f"Nhà thuốc còn {kw} không em?", f"Xem giá {kw} bao nhiêu giúp {me}."])
                gold = [search]
            else:
                text = f"Mua {qty} {kw} giúp {me}, à mà thôi, nhà còn rồi."
                gold = []
            self.add("ph_" + kind, c, text, gold, st)

    # -- bike_rental ------------------------------------------------------------------------------------------------------------
    def bike(self, count):
        r = self.rng
        for _ in range(count):
            c = self.clock()
            kind = r.choices(["rent", "missing_hours", "empty", "end", "rent_remind", "retract"], [16, 6, 4, 7, 4, 3])[0]
            picks = r.sample(STATIONS, 4)
            name = picks[0][0]
            btype = r.choice(["classic", "electric"])
            stations = [{"id": f"st_{k + 1:02d}", "name": f"Trạm {nm}", "address": ad,
                         "bikes": {"classic": r.randint(1, 8), "electric": 0 if (k == 0 and kind == "empty") else r.randint(1, 5)}}
                        for k, (nm, ad) in enumerate(picks)]
            if kind == "empty":
                btype = "electric"
            st = {"bike_rental": {"stations": stations, "rentals": []}}
            me = r.choice(ME)
            hours = r.randint(1, 4)
            hw = r.choice([f"{words(hours)} tiếng", f"{hours} tiếng", f"{words(hours)} giờ"])
            bw = r.choice(BIKE_WORDS[btype])
            find = C("bike_rental.find_stations", query=name)
            rent = C("bike_rental.rent", station_id="st_01", bike_type=btype, hours=hours)
            if kind in ("rent", "empty"):
                text = r.choice([f"Thuê giúp {me} một {bw} ở trạm {name} {hw}.", f"Em mở khoá một {bw} trạm {name} cho {me}, thuê {hw} nhé."])
                gold = [find, rent] if kind == "rent" else [find]
            elif kind == "missing_hours":
                text = r.choice([f"Thuê cho {me} một {bw} ở trạm {name}.", f"{me.capitalize()} muốn lấy {bw} ở {name}, thuê giúp {me}."])
                gold = [ASK("bike_rental.rent", "hours")]
            elif kind == "end":
                st["bike_rental"]["rentals"] = [{"id": "rt_01", "station_id": "st_01", "bike_type": btype, "hours": 2, "status": "active"}]
                text = r.choice([f"{me.capitalize()} trả xe rồi, kết thúc lượt thuê giúp {me}.", f"Đạp xong rồi em, tắt lượt thuê xe đi."])
                gold = [C("bike_rental.my_rentals"), C("bike_rental.end_rental", rental_id="rt_01")]
            elif kind == "rent_remind":
                st["reminders"] = {"reminders": []}
                now = c.now
                back = now + dt.timedelta(hours=hours) - dt.timedelta(minutes=15)
                text = f"Thuê {bw} ở trạm {name} {hw}, rồi nhắc {me} trước mười lăm phút để trả xe."
                gold = [find, rent, C("reminders.create", content="trả xe đạp", time=iso(back.date(), back.hour, back.minute))]
            else:
                text = f"Thuê {bw} ở {name} cho {me}... thôi khỏi, trời mưa rồi."
                gold = []
            self.add("bk_" + kind, c, text, gold, st)

    # -- parcel_locker ----------------------------------------------------------------------------------------------------------
    def locker(self, count):
        r = self.rng
        for _ in range(count):
            c = self.clock()
            kind = r.choices(["open", "extend", "missing_days", "redirect", "dup", "check", "open_sms"], [12, 8, 5, 7, 6, 4, 4])[0]
            picks = r.sample(SENDERS, 3)
            sender, spoken = picks[0]
            parcels = [{"id": f"pc_{k + 1:02d}", "sender": s_, "status": "waiting", "locker": f"Tủ {r.choice(['A', 'B', 'C'])}{r.randint(1, 30)}",
                        "pickup_by": (c.today + dt.timedelta(days=r.randint(1, 3))).isoformat()} for k, (s_, _) in enumerate(picks)]
            if kind == "dup":
                parcels.insert(1, {**parcels[0], "id": f"pc_{len(parcels) + 1:02d}", "locker": "Tủ D7"})
            st = {"parcel_locker": {"parcels": parcels}}
            me = r.choice(ME)
            lst = C("parcel_locker.list_parcels")
            if kind in ("open", "dup"):
                text = r.choice([f"Mở tủ lấy đơn {spoken} cho {me}.", f"{me.capitalize()} tới tủ rồi, mở ô có hàng {spoken} đi em."])
                gold = [lst, C("parcel_locker.open_locker", parcel_id="pc_01")] if kind == "open" else [lst, ASK("parcel_locker.open_locker", "parcel_id")]
            elif kind == "extend":
                d = r.randint(1, 3)
                text = r.choice([f"Gia hạn đơn {spoken} thêm {words(d)} ngày giúp {me}.", f"{me.capitalize()} chưa lấy hàng {spoken} kịp, giữ thêm {d} ngày nhé."])
                gold = [lst, C("parcel_locker.extend_pickup", parcel_id="pc_01", days=d)]
            elif kind == "missing_days":
                text = f"Gia hạn giúp {me} đơn {spoken} ở tủ nhé."
                gold = [ASK("parcel_locker.extend_pickup", "days")]
            elif kind == "redirect":
                spoken_addr, addr = r.choice(ADDRESSES)
                text = f"Chuyển đơn {spoken} về {spoken_addr} giúp {me}."
                gold = [lst, C("parcel_locker.redirect", parcel_id="pc_01", address=addr)]
            elif kind == "check":
                text = r.choice([f"Có hàng nào đang chờ ở tủ không em?", f"Xem giúp {me} tủ nhận hàng có gì không."])
                gold = [lst]
            else:
                who = r.choice(CONTACT_POOL)[0]
                st["contacts"] = contacts_state(r, [who])
                st["sms"] = {"messages": []}
                text = f"Mở tủ lấy đơn {spoken} rồi nhắn {spoken_contact(who)} là đã lấy hàng."
                gold = [lst, C("parcel_locker.open_locker", parcel_id="pc_01"), C("contacts.search", query=who),
                        C("sms.send", contact_id=contact_id(st["contacts"], who), content="đã lấy hàng")]
            self.add("lk_" + kind, c, text, gold, st)


def build() -> list[dict]:
    g = Held()
    g.gym(48)
    g.pharmacy(48)
    g.bike(40)
    g.locker(44)
    return g.tasks


TASKS = build()
