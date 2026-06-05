# Cấu Hình Firestore Security Rules

Dự án hiện tại dùng 2 nhóm dữ liệu Firestore.

## 1. Dữ Liệu Realtime Từ ESP32

ESP32 cập nhật liên tục document:

```text
realtime_data/esp32_sensor
```

Document này có các field:

```text
bpm    number
spo2   number
temp   number
uptime number
```

Web React đọc document này bằng `onSnapshot()` để hiển thị dữ liệu realtime.

## 2. Dữ Liệu Lịch Sử Của Web

Khi người dùng bắt đầu đo, web lưu lịch sử tại:

```text
artifacts/web-monitor/users/{userId}/health_data/{docId}
```

Mỗi document lịch sử có field:

```text
records: [
  {
    timestamp,
    bpm,
    spo2,
    temp,
    patientName,
    patientAge,
    patientGender
  }
]
```

## Rules Dùng Để Test Nhanh

Chỉ nên dùng khi demo nội bộ hoặc debug:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

Rules này tiện cho thử nghiệm, nhưng không an toàn khi public.

## Rules Khuyến Nghị Cho Dự Án

Rules này cho phép:

- ESP32 ghi document realtime.
- Web đọc document realtime.
- User đã đăng nhập anonymous đọc/ghi lịch sử của chính user đó.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /realtime_data/esp32_sensor {
      allow read: if true;
      allow write: if request.resource.data.keys().hasAll(['bpm', 'spo2', 'temp', 'uptime'])
                   && request.resource.data.bpm is number
                   && request.resource.data.spo2 is number
                   && request.resource.data.temp is number
                   && request.resource.data.uptime is number;
    }

    match /artifacts/{appId}/users/{userId}/health_data/{docId} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId;
    }
  }
}
```

## Ghi Chú Bảo Mật

Firmware ESP32 hiện đang dùng Firebase test mode:

```cpp
config.signer.test_mode = true;
```

Vì vậy ESP32 không đăng nhập bằng user Firebase thông thường. Nếu cần bảo mật hơn khi triển khai thật, nên chuyển sang cơ chế xác thực riêng cho thiết bị hoặc dùng backend trung gian.

## Cách Kiểm Tra

Sau khi nạp firmware và mở web, vào Firestore kiểm tra:

```text
realtime_data/esp32_sensor
```

Nếu ESP32 online, các field `bpm`, `spo2`, `temp`, `uptime` sẽ được cập nhật liên tục.

Khi web bắt đầu đo và có user anonymous, lịch sử sẽ được lưu tại:

```text
artifacts/web-monitor/users/{userId}/health_data/{YYYYMMDD}
```
