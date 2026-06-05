# Hướng Dẫn Code Hệ Thống Giám Sát Sức Khỏe

Tài liệu này mô tả cấu trúc code hiện tại của hệ thống, gồm firmware ESP32 và ứng dụng web React.

## 1. Tổng Quan Hệ Thống

Hệ thống theo dõi các chỉ số sức khỏe cơ bản:

- Nhịp tim BPM.
- Nồng độ oxy máu SpO2.
- Nhiệt độ cơ thể.
- Sóng mạch PPG.

Luồng dữ liệu chính:

```text
Cảm biến MAX30102 + DS18B20
        |
        v
ESP32 xử lý và tính toán
        |
        |-- Serial CSV --> WinForms
        |
        |-- Firebase Firestore --> Web React
```

ESP32 gửi dữ liệu realtime lên Firestore tại:

```text
realtime_data/esp32_sensor
```

Web React lắng nghe document này bằng `onSnapshot()` để hiển thị realtime. Khi người dùng bắt đầu phiên đo, web lưu lịch sử vào:

```text
artifacts/web-monitor/users/{userId}/health_data/{docId}
```

## 2. Firmware ESP32

File firmware:

```text
src/doantotnghiep.ino
```

### 2.1. Thư Viện Chính

```cpp
#include <WiFi.h>
#include <Wire.h>
#include "MAX30105.h"
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Firebase_ESP_Client.h>
```

Vai trò:

- `WiFi.h`: kết nối WiFi.
- `MAX30105.h`: giao tiếp MAX30102/MAX30105.
- `OneWire.h`, `DallasTemperature.h`: đọc cảm biến DS18B20.
- `Adafruit_SSD1306.h`: điều khiển màn hình OLED.
- `Firebase_ESP_Client.h`: gửi dữ liệu lên Firestore.

### 2.2. Cấu Hình WiFi Và Firebase

```cpp
const char* WIFI_SSID = "Dvc";
const char* WIFI_PASS = "99999999";

#define API_KEY "..."
#define PROJECT_ID "du-lieu-cb"
```

WiFi được cấu hình cố định trong code. ESP32 tự kết nối khi khởi động và tự kết nối lại khi mất WiFi.

Các mốc thời gian WiFi:

```cpp
#define WIFI_BOOT_TIMEOUT 6000
#define RECONNECT_INTERVAL 2000
#define FIREBASE_INIT_DELAY 1000
```

`WiFi.setSleep(false)` được dùng để tăng độ ổn định và giảm độ trễ khi bắt lại WiFi.

### 2.3. Cảm Biến MAX30102/MAX30105

Cảm biến đọc hai kênh:

- IR: dùng chính để phát hiện ngón tay, lọc tín hiệu và tính BPM.
- Red: dùng cùng IR để tính SpO2.

Cấu hình cảm biến:

```cpp
particleSensor.setup(30, 1, 2, 100, 411, 4096);
```

Ngưỡng phát hiện có ngón tay:

```cpp
#define FINGER_THRESHOLD 50000
```

Khi IR thấp hơn ngưỡng, hệ thống đưa BPM/SpO2 về 0.

### 2.4. Tính BPM

Tín hiệu IR được đưa qua bộ lọc thông dải:

```cpp
filteredSignal = bandpassFilter((float)rawIR);
```

Hệ thống tính ngưỡng động dựa trên trung bình và độ lệch chuẩn của cửa sổ mẫu:

```cpp
threshold = mean + (0.6 * stdDev);
```

Khi tín hiệu tạo đỉnh hợp lệ, khoảng cách giữa hai đỉnh được dùng để tính BPM:

```cpp
instantBPM = 60000.0 / interval;
```

BPM hợp lệ nằm trong khoảng 40-200. Giá trị hiển thị là trung bình trượt 5 mẫu gần nhất.

### 2.5. Tính SpO2

SpO2 được tính sau mỗi `BUFFER_SIZE = 100` mẫu. Code lấy giá trị min/max của Red và IR để ước lượng AC/DC:

```cpp
R = (acRed / dcRed) / (acIR / dcIR);
spo2 = -45.060 * R * R + 30.354 * R + 94.845;
```

Giá trị SpO2 được giới hạn trong khoảng 0-100 và làm mượt bằng trung bình 5 mẫu.

### 2.6. Nhiệt Độ DS18B20

DS18B20 được đọc không blocking trong task riêng:

```cpp
sensors.setWaitForConversion(false);
```

Task `TaskFirebaseRun()` phụ trách:

- Kích hoạt chuyển đổi nhiệt độ.
- Đọc kết quả sau `TEMP_CONVERSION_DELAY`.
- Gửi Firebase theo chu kỳ.

Lưu ý: DS18B20 không phải thiết bị y tế, giá trị đo phụ thuộc tiếp xúc da, vị trí kẹp và môi trường. Có thể hiệu chỉnh offset thực nghiệm nếu cần.

### 2.7. OLED

OLED có 2 màn hình:

1. Màn hình thông số:

```text
HR
SpO2
Temp
WIFI ON/OFF
```

2. Màn hình sóng PPG:

```text
Sóng PPG + HR/SpO2 trên thanh trên
```

Nút bấm dùng để đổi qua lại giữa 2 màn hình. SpO2 trên OLED hiển thị 1 chữ số thập phân để đồng nhất với web và WinForms.

### 2.8. Còi Pip Theo Nhịp Tim

Còi được kích khi phát hiện đỉnh mạch hợp lệ:

```cpp
#define MIN_PEAK_INTERVAL_MS 300
#define BEEP_DURATION_MS 60
#define VALID_BPM_MIN 40
#define VALID_BPM_MAX 200
```

Mỗi đỉnh mạch hợp lệ tạo một tiếng pip ngắn 60 ms. Đây là mô phỏng theo nhịp mạch, không thay thế thiết bị ECG/y tế chuyên dụng.

### 2.9. Gửi Serial Cho WinForms

ESP32 gửi CSV theo format:

```text
t_us,IR,Red,Vt,BPM,SpO2
```

Ví dụ:

```text
2188910,528,793,0.0000,63,99.50
```

WinForms dùng dữ liệu này để hiển thị chỉ số và vẽ sóng.

### 2.10. Gửi Firebase Realtime

ESP32 patch document:

```text
realtime_data/esp32_sensor
```

Field gửi lên:

```text
bpm
spo2
temp
uptime
```

Chu kỳ gửi:

```cpp
#define FIREBASE_SEND_INTERVAL 250
```

## 3. Web React

File chính:

```text
src/App.jsx
```

### 3.1. Khởi Tạo Firebase

Web khởi tạo Firebase bằng:

```jsx
initializeApp(firebaseConfig)
getFirestore(app)
getAuth(app)
```

`appId` đang dùng:

```jsx
const appId = 'web-monitor';
```

### 3.2. Đăng Nhập

Web dùng Firebase Auth anonymous để lấy `userId`. `userId` này dùng để tạo đường dẫn lưu lịch sử riêng cho từng người dùng.

### 3.3. Nhận Dữ Liệu Realtime

Web lắng nghe document:

```jsx
const docRef = doc(db, 'realtime_data', 'esp32_sensor');
onSnapshot(docRef, callback);
```

Mỗi khi ESP32 cập nhật Firestore, web nhận:

```text
bpm
spo2
temp
uptime
```

Sau đó cập nhật card thông số, biểu đồ và trạng thái kết nối. Nếu sau 5 giây không có dữ liệu mới, web hiển thị trạng thái ESP32 mất kết nối hoặc đang tắt.

### 3.4. Lưu Lịch Sử

Khi người dùng bắt đầu đo, web lưu bản ghi mới mỗi 10 giây:

```text
artifacts/web-monitor/users/{userId}/health_data/{YYYYMMDD}
```

Mỗi bản ghi gồm:

```text
timestamp
bpm
spo2
temp
patientName
patientAge
patientGender
```

Dữ liệu được thêm vào mảng `records` bằng `arrayUnion`.

### 3.5. Lịch Sử Và Xuất Excel

Khi chọn ngày, web đọc document lịch sử theo ngày:

```text
health_data/{YYYYMMDD}
```

Nếu có dữ liệu, web hiển thị bảng lịch sử, biểu đồ lịch sử và cho phép xuất file Excel.

Thư viện xuất Excel:

```jsx
import * as XLSX from 'xlsx-js-style';
```

## 4. Các File Quan Trọng

```text
src/doantotnghiep.ino   Firmware ESP32
src/App.jsx             Giao diện và logic web
src/App.css             Style chính
src/main.jsx            Entry React
src/index.css           Style global
public/utc-logo.png     Logo trường
public/CAY.PNG          Ảnh sinh viên
```

## 5. Lưu Ý Khi Báo Cáo

- Hệ thống có tính chất giám sát và tham khảo, không phải thiết bị y tế chẩn đoán.
- MAX30102 và DS18B20 có sai số phụ thuộc cách đặt cảm biến.
- Dữ liệu web và WinForms đồng nhất vì đều nhận giá trị đã tính từ ESP32/Firebase.
- Firebase đóng vai trò trung gian realtime giữa ESP32 và web.
