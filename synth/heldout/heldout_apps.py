"""Held-out evaluation apps (never used for training): new everyday services in the zaic_tools App style, one class per app,
one method per tool, never raises. scripts/data/build_synth_split.py --apps copies this module into the split's zaic_tools/apps/."""
from __future__ import annotations

from .base import App, read, write


class GymBooking(App):
    name = "gym_booking"

    @read
    def search_classes(self, date=None, query=None, **_):
        out = self.read("classes", contains={("name", "trainer", "studio"): query})
        if date:
            out["classes"] = [c for c in out["classes"] if str(c.get("start", ""))[:10] == date]
        return out

    @read
    def my_bookings(self, **_):
        return self.read("bookings", eq={"status": "booked"})

    @write
    def book_class(self, class_id=None, note=None, **_):
        c = self.find("classes", class_id)
        if c is None:
            return self.noop(f"không tìm thấy class_id={class_id!r}")
        if c.get("spots_left", 0) <= 0:
            return self.noop(f"lớp {c['id']} đã hết chỗ")
        c["spots_left"] -= 1
        r = self.create("bookings", "gb", class_id=c["id"], start=c.get("start"), note=note, status="booked")
        return {"ok": True, "booking": r["item"]}

    @write
    def cancel_booking(self, booking_id=None, **_):
        b = self.find("bookings", booking_id)
        if b is None or b.get("status") != "booked":
            return self.noop(f"không có lượt đặt đang hiệu lực booking_id={booking_id!r}")
        b["status"] = "cancelled"
        c = self.find("classes", b.get("class_id"))
        if c is not None:
            c["spots_left"] = c.get("spots_left", 0) + 1
        return {"ok": True, "booking": b}


class Pharmacy(App):
    name = "pharmacy"

    @read
    def search_products(self, query=None, **_):
        return self.read("products", contains={("name", "use"): query})

    @read
    def list_orders(self, **_):
        return self.read("orders")

    @write
    def order(self, product_id=None, quantity=None, note=None, **_):
        p = self.find("products", product_id)
        if p is None:
            return self.noop(f"không tìm thấy product_id={product_id!r}")
        if p.get("stock", 0) < (quantity or 0):
            return self.noop(f"sản phẩm {p['id']} chỉ còn {p.get('stock', 0)}")
        p["stock"] -= quantity
        r = self.create("orders", "ph", product_id=p["id"], quantity=quantity, note=note, status="placed")
        return {"ok": True, "order": r["item"]}

    @write
    def cancel_order(self, order_id=None, **_):
        o = self.find("orders", order_id)
        if o is None or o.get("status") != "placed":
            return self.noop(f"không có đơn đang xử lý order_id={order_id!r}")
        o["status"] = "cancelled"
        p = self.find("products", o.get("product_id"))
        if p is not None:
            p["stock"] = p.get("stock", 0) + (o.get("quantity") or 0)
        return {"ok": True, "order": o}

    @write
    def set_refill_reminder(self, product_id=None, every_days=None, **_):
        p = self.find("products", product_id)
        if p is None:
            return self.noop(f"không tìm thấy product_id={product_id!r}")
        r = self.create("refills", "rf", product_id=p["id"], every_days=every_days)
        return {"ok": True, "refill": r["item"]}


class BikeRental(App):
    name = "bike_rental"

    @read
    def find_stations(self, query=None, **_):
        return self.read("stations", contains={("name", "address"): query})

    @read
    def my_rentals(self, **_):
        return self.read("rentals", eq={"status": "active"})

    @write
    def rent(self, station_id=None, bike_type=None, hours=None, **_):
        s = self.find("stations", station_id)
        if s is None:
            return self.noop(f"không tìm thấy station_id={station_id!r}")
        if s.get("bikes", {}).get(bike_type, 0) <= 0:
            return self.noop(f"trạm {s['id']} hết xe {bike_type}")
        s["bikes"][bike_type] -= 1
        r = self.create("rentals", "rt", station_id=s["id"], bike_type=bike_type, hours=hours, status="active")
        return {"ok": True, "rental": r["item"]}

    @write
    def end_rental(self, rental_id=None, **_):
        return self.patch("rentals", "rental_id", rental_id, require={"status": "active"}, status="ended")


class ParcelLocker(App):
    name = "parcel_locker"

    @read
    def list_parcels(self, status=None, **_):
        return self.read("parcels", eq={"status": status})

    @write
    def open_locker(self, parcel_id=None, **_):
        p = self.find("parcels", parcel_id)
        if p is None or p.get("status") != "waiting":
            return self.noop(f"không có bưu kiện đang chờ parcel_id={parcel_id!r}")
        p["status"] = "collected"
        return {"ok": True, "parcel": p}

    @write
    def extend_pickup(self, parcel_id=None, days=None, **_):
        p = self.find("parcels", parcel_id)
        if p is None or p.get("status") != "waiting":
            return self.noop(f"không có bưu kiện đang chờ parcel_id={parcel_id!r}")
        p["extended_days"] = (p.get("extended_days") or 0) + (days or 0)
        return {"ok": True, "parcel": p}

    @write
    def redirect(self, parcel_id=None, address=None, **_):
        p = self.find("parcels", parcel_id)
        if p is None or p.get("status") != "waiting":
            return self.noop(f"không có bưu kiện đang chờ parcel_id={parcel_id!r}")
        p["status"] = "redirected"
        p["address"] = address
        return {"ok": True, "parcel": p}
