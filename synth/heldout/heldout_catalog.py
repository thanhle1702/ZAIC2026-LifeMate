"""Catalog entries of the held-out evaluation apps (synth/heldout/heldout_apps.py), same helpers and conventions as synth/catalog.py.
These apps are used only to measure transfer to unseen apps; no adapter is trained on them."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from catalog import DATE, INT, app, i, ref_id, s, tool  # noqa: E402  (synth/catalog.py)

A = "gym_booking"
GYM = app(A, "Đặt lớp tập gym", "health", "Tìm lớp tập (yoga, gym, bơi...), đặt chỗ hoặc huỷ chỗ đã đặt", [
    tool(A, "search_classes", "read", "Tìm lớp tập theo ngày hoặc tên lớp, huấn luyện viên; kết quả có số chỗ còn trống (spots_left)",
         {"date": s(DATE, fmt="date"), "query": s("Tên lớp, huấn luyện viên hoặc phòng tập")}, returns="classes[]"),
    tool(A, "my_bookings", "read", "Các lớp người dùng đã đặt và còn hiệu lực", {}, returns="bookings[]"),
    tool(A, "book_class", "write", "Đặt một chỗ trong lớp tập",
         {"class_id": ref_id("lớp tập", "gym_booking.search_classes", "gym_booking.classes"),
          "note": s("Ghi chú cho huấn luyện viên, chỉ khi người dùng nói", fuzzy=True)}, ["class_id"]),
    tool(A, "cancel_booking", "write", "Huỷ một lượt đặt lớp",
         {"booking_id": ref_id("lượt đặt", "gym_booking.my_bookings", "gym_booking.bookings")}, ["booking_id"]),
])

A = "pharmacy"
PHARMACY = app(A, "Nhà thuốc online", "health", "Tìm thuốc và sản phẩm y tế, đặt mua giao tận nhà, huỷ đơn, hẹn nhắc mua lại", [
    tool(A, "search_products", "read", "Tìm sản phẩm theo tên hoặc công dụng; kết quả có giá và tồn kho",
         {"query": s("Tên thuốc hoặc công dụng, ví dụ hạ sốt")}, returns="products[]"),
    tool(A, "list_orders", "read", "Các đơn đã đặt", {}, returns="orders[]"),
    tool(A, "order", "write", "Đặt mua một sản phẩm",
         {"product_id": ref_id("sản phẩm", "pharmacy.search_products", "pharmacy.products"), "quantity": i("Số lượng (hộp, chai...). " + INT, lo=1, hi=20),
          "note": s("Ghi chú giao hàng, chỉ khi người dùng nói", fuzzy=True)}, ["product_id", "quantity"]),
    tool(A, "cancel_order", "write", "Huỷ một đơn chưa giao", {"order_id": ref_id("đơn", "pharmacy.list_orders", "pharmacy.orders")}, ["order_id"]),
    tool(A, "set_refill_reminder", "write", "Hẹn nhắc mua lại một sản phẩm theo chu kỳ ngày",
         {"product_id": ref_id("sản phẩm", "pharmacy.search_products", "pharmacy.products"), "every_days": i("Chu kỳ (ngày). " + INT, lo=1, hi=90)},
         ["product_id", "every_days"]),
])

A = "bike_rental"
BIKE = app(A, "Thuê xe đạp công cộng", "transport", "Tìm trạm xe đạp, thuê xe theo giờ, trả xe", [
    tool(A, "find_stations", "read", "Tìm trạm theo tên hoặc địa chỉ; kết quả có số xe từng loại còn ở trạm (bikes)",
         {"query": s("Tên trạm hoặc đường, ví dụ Nhà hát Lớn")}, returns="stations[]"),
    tool(A, "my_rentals", "read", "Các lượt thuê đang chạy", {}, returns="rentals[]"),
    tool(A, "rent", "write", "Thuê một xe tại trạm",
         {"station_id": ref_id("trạm", "bike_rental.find_stations", "bike_rental.stations"),
          "bike_type": s("classic = xe đạp thường, electric = xe đạp điện", enum=["classic", "electric"]),
          "hours": i("Số giờ thuê. " + INT, lo=1, hi=12)}, ["station_id", "bike_type", "hours"]),
    tool(A, "end_rental", "write", "Kết thúc (trả) một lượt thuê", {"rental_id": ref_id("lượt thuê", "bike_rental.my_rentals", "bike_rental.rentals")},
         ["rental_id"]),
])

A = "parcel_locker"
LOCKER = app(A, "Tủ nhận hàng", "shopping", "Xem bưu kiện đang chờ ở tủ, mở tủ lấy hàng, gia hạn hoặc chuyển giao đến địa chỉ khác", [
    tool(A, "list_parcels", "read", "Các bưu kiện của người dùng ở tủ, có người gửi (sender) và hạn lấy",
         {"status": s(enum=["waiting", "collected", "redirected"])}, returns="parcels[]"),
    tool(A, "open_locker", "write", "Mở ô tủ để lấy một bưu kiện đang chờ", {"parcel_id": ref_id("bưu kiện", "parcel_locker.list_parcels", "parcel_locker.parcels")},
         ["parcel_id"]),
    tool(A, "extend_pickup", "write", "Gia hạn thời gian giữ bưu kiện ở tủ",
         {"parcel_id": ref_id("bưu kiện", "parcel_locker.list_parcels", "parcel_locker.parcels"), "days": i("Số ngày gia hạn. " + INT, lo=1, hi=5)},
         ["parcel_id", "days"]),
    tool(A, "redirect", "write", "Chuyển bưu kiện đang chờ đến một địa chỉ khác",
         {"parcel_id": ref_id("bưu kiện", "parcel_locker.list_parcels", "parcel_locker.parcels"), "address": s("Địa chỉ nhận mới", fuzzy=True)},
         ["parcel_id", "address"]),
])

APPS = [GYM, PHARMACY, BIKE, LOCKER]
