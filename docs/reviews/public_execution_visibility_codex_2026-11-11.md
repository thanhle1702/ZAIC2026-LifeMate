# Codex — hiển thị lỗi thực thi public test

Nguyên nhân: PASS/FAIL và bộ lọc cũ dùng taskSuccess. Public không có nhãn nên runtime errors bị chìm dưới CHƯA CHẤM. Dòng tổng kết còn đọc validation.incomplete_samples không tồn tại rồi mặc định bằng 0; checked/expected cũng không khớp rows trong artifact mới.

Đã thêm execution health độc lập với task success, tổng hợp từ evaluations.json có cache theo mtime/size. Áp dụng được cho artifact cũ, không cần chạy model lại. Danh sách job hiển thị số hoàn tất/lỗi, nguyên nhân và IDs; live có số lỗi; bảng và inspector hiển thị LỖI THỰC THI cùng stop reason. Có nút xem mẫu lỗi, bộ lọc runtime và tìm kiếm theo reason. Chỉ ca thất bại giờ bao gồm runtime error và sai lệch đã quan sát, không yêu cầu public GT. Validation replay không còn ngầm được hiểu là task success.

Đã build và chạy 45 unit tests thành công. Browser thật xác nhận run v0-pub có 615 completed / 19 incomplete, gồm tool_error 8 và duplicate_loop 11; lọc runtime và tìm tool_error trả đúng nhóm, không có page error. Không sửa dữ liệu, không khởi chạy inference, không thay chính sách submission hoặc sửa nguyên nhân của 19 mẫu trong đợt UI này.
