# Hệ Thống Giám Sát Sức Khỏe ESP32

Dự án gồm 3 phần chính:

- Firmware ESP32: đọc cảm biến MAX30102/MAX30105, DS18B20, hiển thị OLED, gửi dữ liệu lên Firebase Firestore và Serial.
- Web React/Vite: lắng nghe dữ liệu realtime từ Firestore, hiển thị dashboard, biểu đồ, lịch sử và xuất Excel.
- Ứng dụng WinForms: nhận dữ liệu CSV qua cổng COM để hiển thị BPM, SpO2 và sóng PPG.

## Luồng Dữ Liệu

```text
MAX30102 + DS18B20
        |
        v
ESP32 doantotnghiep.ino
        |
        |-- Serial CSV --> WinForms
        |
        |-- Firestore realtime_data/esp32_sensor --> Web React
                                                       |
                                                       v
                                         Lưu lịch sử artifacts/.../health_data
```

## Chạy Web

```powershell
npm install
npm run dev
```

Build để deploy:

```powershell
npm run build
```

Thư mục build:

```text
dist/
```

## Firmware ESP32

File firmware:

```text
src/doantotnghiep.ino
```

WiFi đang cấu hình cố định trong file:

```cpp
const char* WIFI_SSID = "Dvc";
const char* WIFI_PASS = "99999999";
```

Dữ liệu realtime gửi lên Firestore document:

```text
realtime_data/esp32_sensor
```

Dữ liệu Serial gửi cho WinForms theo format:

```text
t_us,IR,Red,Vt,BPM,SpO2
```

## Công Nghệ Sử Dụng

- ESP32 Arduino
- MAX30102/MAX30105
- DS18B20
- OLED SSD1306
- Firebase Firestore
- React + Vite
- Chart.js
- xlsx-js-style
