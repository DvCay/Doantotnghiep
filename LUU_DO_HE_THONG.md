# Lưu Đồ Hệ Thống Giám Sát Sức Khỏe

Tài liệu này tóm tắt các luồng xử lý chính của hệ thống hiện tại.

## 1. Lưu Đồ Tổng Quan

```mermaid
flowchart TD
    A([Bắt đầu]) --> B[Khởi động ESP32]
    B --> C[Khởi tạo cảm biến MAX30102 và DS18B20]
    B --> D[Kết nối WiFi cố định]
    D --> E{WiFi kết nối?}
    E -->|Có| F[Khởi tạo Firebase]
    E -->|Không| G[Chạy offline và thử reconnect]
    F --> H[Đọc cảm biến liên tục]
    G --> H
    H --> I[Tính BPM, SpO2, nhiệt độ]
    I --> J[Hiển thị OLED]
    I --> K[Gửi Serial CSV cho WinForms]
    I --> L{WiFi + Firebase sẵn sàng?}
    L -->|Có| M[Cập nhật Firestore realtime_data/esp32_sensor]
    L -->|Không| G
    M --> N[Web React lắng nghe onSnapshot]
    N --> O[Hiển thị dashboard realtime]
    O --> P{Người dùng bắt đầu đo?}
    P -->|Có| Q[Lưu lịch sử vào artifacts/.../health_data]
    P -->|Không| O
    Q --> R[Xem lịch sử và xuất Excel]
```

## 2. Lưu Đồ Firmware ESP32

```mermaid
flowchart TD
    A([setup]) --> B[Serial.begin và Wire.begin]
    B --> C[Cấu hình LED, buzzer, nút bấm]
    C --> D[Khởi tạo OLED]
    D --> E[Hiện SYSTEM START]
    E --> F[setupWiFiBoot]
    F --> G[setupMAX30102]
    G --> H[Khởi tạo DS18B20]
    H --> I[Tạo task FirebaseTask trên core 0]
    I --> J([loop])
    J --> K[handleButton]
    K --> L[handleWiFiReconnection]
    L --> M[particleSensor.check]
    M --> N{Có mẫu cảm biến?}
    N -->|Có| O[Đọc IR và Red]
    O --> P{IR > FINGER_THRESHOLD?}
    P -->|Có| Q[Lọc tín hiệu và phát hiện peak]
    Q --> R[Tính BPM]
    Q --> S[Tích lũy buffer tính SpO2]
    P -->|Không| T[Reset BPM, SpO2, buzzer]
    R --> U[Cập nhật sóng OLED và Serial CSV]
    S --> U
    T --> U
    U --> V[updateOLED mỗi 30 ms]
    V --> J
```

## 3. Lưu Đồ WiFi Và Firebase Trên ESP32

```mermaid
flowchart TD
    A([Khởi động WiFi]) --> B[WiFi.mode STA]
    B --> C[WiFi.setSleep false]
    C --> D[WiFi.begin SSID/PASS]
    D --> E{Kết nối trong timeout?}
    E -->|Có| F[MODE_ONLINE]
    E -->|Không| G[MODE_OFFLINE]
    F --> H[Chờ FIREBASE_INIT_DELAY]
    H --> I[Firebase.begin]
    I --> J[Gửi Firestore mỗi FIREBASE_SEND_INTERVAL]
    G --> K[Mỗi RECONNECT_INTERVAL thử kết nối lại]
    K --> D
    J --> L{Mất WiFi?}
    L -->|Có| M[Tắt Firebase reconnect flag]
    M --> G
    L -->|Không| J
```

## 4. Lưu Đồ Gửi Dữ Liệu Realtime

```mermaid
flowchart TD
    A[ESP32 tính xong BPM, SpO2, Temp] --> B{WiFi và Firebase sẵn sàng?}
    B -->|Không| C[Bỏ qua lần gửi]
    B -->|Có| D[Tạo FirebaseJson]
    D --> E[Set fields: bpm, spo2, temp, uptime]
    E --> F[Patch document realtime_data/esp32_sensor]
    F --> G{Thành công?}
    G -->|Có| H[Web nhận dữ liệu mới]
    G -->|Không| I[In lỗi mỗi 3 giây]
```

## 5. Lưu Đồ Web React Nhận Realtime

```mermaid
flowchart TD
    A([Mở web]) --> B[Khởi tạo Firebase]
    B --> C[Đăng nhập anonymous]
    C --> D[Lắng nghe realtime_data/esp32_sensor]
    D --> E{Document có dữ liệu?}
    E -->|Có| F[Đọc bpm, spo2, temp, uptime]
    F --> G[Cập nhật card thông số]
    F --> H[Cập nhật biểu đồ live]
    F --> I[Đặt trạng thái ESP32 Online]
    E -->|Không| J[Chờ dữ liệu cảm biến]
    I --> K{Quá 5 giây không có update?}
    K -->|Có| L[Thông báo ESP32 mất kết nối]
    K -->|Không| D
```

## 6. Lưu Đồ Lưu Lịch Sử

```mermaid
flowchart TD
    A[Người dùng bấm Bắt đầu đo] --> B{Đã nhập tên bệnh nhân?}
    B -->|Không| C[Thông báo yêu cầu nhập tên]
    B -->|Có| D[isMeasuring = true]
    D --> E[Web tiếp tục nhận realtime từ Firebase]
    E --> F{Đủ 10 giây từ lần lưu trước?}
    F -->|Không| E
    F -->|Có| G[Tạo record lịch sử]
    G --> H[Build path artifacts/web-monitor/users/userId/health_data/YYYYMMDD]
    H --> I[setDoc merge + arrayUnion]
    I --> J{Lưu thành công?}
    J -->|Có| K[Cập nhật trạng thái đã lưu]
    J -->|Không| L[Cập nhật trạng thái lỗi]
    K --> E
    L --> E
```

## 7. Lưu Đồ Chọn Ngày Và Xem Lịch Sử

```mermaid
flowchart TD
    A[Người dùng chọn ngày] --> B[Chuyển ngày thành YYYYMMDD]
    B --> C{Ngày được chọn là hôm nay?}
    C -->|Có| D[Chuyển về live mode]
    C -->|Không| E[Chuyển sang historical mode]
    D --> F[Đọc lịch sử hôm nay nếu có]
    E --> G[Đọc Firestore health_data/YYYYMMDD]
    F --> H[Hiện popup/dữ liệu lịch sử]
    G --> I{Có dữ liệu?}
    I -->|Có| J[Vẽ biểu đồ lịch sử và bảng record]
    I -->|Không| K[Thông báo không có dữ liệu]
```

## 8. Lưu Đồ Xuất Excel

```mermaid
flowchart TD
    A[Người dùng bấm Xuất Excel] --> B[Lấy records ngày đang xem]
    B --> C{Có dữ liệu?}
    C -->|Không| D[Thông báo chưa có dữ liệu]
    C -->|Có| E[Tạo worksheet]
    E --> F[Thêm tiêu đề, thông tin bệnh nhân]
    F --> G[Thêm cột thời gian, BPM, SpO2, nhiệt độ, trạng thái]
    G --> H[Định dạng màu sắc, font, border]
    H --> I[Tạo file .xlsx]
    I --> J[Tải file về máy]
```

## 9. Lưu Đồ Nút OLED

```mermaid
flowchart TD
    A[Đọc BUTTON_PIN] --> B{Trạng thái ổn định sau debounce?}
    B -->|Không| A
    B -->|Có| C{Nút vừa nhả?}
    C -->|Không| A
    C -->|Có| D[Đảo showWave]
    D --> E{showWave?}
    E -->|Không| F[Hiện màn thông số]
    E -->|Có| G[Hiện màn sóng PPG]
```

## 10. Ghi Chú Cho Báo Cáo

- ESP32 là nút thu thập và xử lý tín hiệu cảm biến.
- Firestore là lớp trung gian realtime giữa ESP32 và web.
- Web vừa hiển thị realtime, vừa lưu lịch sử theo người dùng.
- WinForms đọc trực tiếp Serial CSV để hiển thị sóng và chỉ số.
- Hệ thống phù hợp mục đích giám sát/tham khảo, không thay thế thiết bị y tế chuyên dụng.
