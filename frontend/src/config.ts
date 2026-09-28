// Địa chỉ Backend FastAPI (tự động nhận diện origin khi chạy cùng port hoặc cấu hình qua biến môi trường)
export const API_BASE =
  typeof window !== "undefined" && window.location.port === "8000"
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000");

