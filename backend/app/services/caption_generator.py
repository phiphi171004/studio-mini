import os
import re
import json
import httpx
from typing import List, Dict, Any, Optional
from ..config import (
    GEMINI_API_KEY,
    GEMINI_MODEL,
    AI_TRANSLATE_API_KEY,
    AI_TRANSLATE_MODEL
)

def safe_log(msg: str):
    try:
        print(msg)
    except Exception:
        try:
            print(msg.encode("ascii", "replace").decode("ascii"))
        except Exception:
            pass

class CaptionGeneratorService:
    """
    Dịch vụ tạo Tiêu Đề và Caption bài viết Fanpage Facebook / Reels / TikTok
    tự động bằng Google Gemini dựa trên kịch bản video đã lồng tiếng.
    """

    @classmethod
    async def generate_fanpage_caption(
        cls,
        transcript_text: str,
        style: str = "viral",
        custom_instructions: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Gọi Google Gemini để sáng tạo nội dung bài đăng Fanpage hoàn chỉnh.
        """
        effective_key = (
            api_key
            or GEMINI_API_KEY
            or AI_TRANSLATE_API_KEY
            or os.getenv("GEMINI_API_KEY", "")
            or os.getenv("GOOGLE_API_KEY", "")
            or ""
        ).strip()

        effective_model = (
            model
            or GEMINI_MODEL
            or AI_TRANSLATE_MODEL
            or "gemini-2.5-flash"
        ).strip()

        if not effective_key:
            raise ValueError("Chưa cấu hình Google Gemini API Key.")

        style_guides = {
            "viral": (
                "PHONG CÁCH: GIẬT TÍT VIRAL & TÒ MÒ\n"
                "- Mở đầu bằng câu hook cực mạnh, gây tò mò cao độ, kích thích người lướt feed dừng lại ngay lập tức.\n"
                "- Nhấn mạnh vào sự thật bất ngờ, mẹo độc lạ hoặc công dụng không ngờ tới trong video."
            ),
            "sales": (
                "PHONG CÁCH: BÁN HÀNG & REVIEW THỰC CHIẾN\n"
                "- Nêu bật vấn đề/nỗi đau thường ngày mà người xem hay gặp -> giới thiệu giải pháp xuất hiện trong video.\n"
                "- Nêu các ưu điểm tiện lợi, chất lượng, độ bền. Kêu gọi chốt đơn, để lại bình luận hoặc nhắn tin nhận link."
            ),
            "story": (
                "PHONG CÁCH: HÀI HƯỚC & KỂ CHUYỆN GẦN GŨI\n"
                "- Giọng điệu dí dỏm, thân thiện, như một người bạn đang chia sẻ trải nghiệm cười ra nước mắt.\n"
                "- Sử dụng các từ ngữ trending, duyên dáng, kích thích người xem tag bạn bè vào bình luận."
            ),
            "reels": (
                "PHONG CÁCH: NGẮN GỌN REELS / TIKTOK / SHORTS\n"
                "- Bài viết siêu ngắn (chỉ 3-5 câu), dứt khoát, đi thẳng vào trọng tâm.\n"
                "- Tối ưu cho người xem video nhanh, đọc lướt trong 3 giây."
            ),
        }

        selected_style_guide = style_guides.get(style.lower(), style_guides["viral"])

        system_instruction = (
            "Bạn là Chuyên gia Social Media Marketing & Content Creator hàng đầu cho các Fanpage triệu view trên Facebook, Reels và TikTok.\n"
            "Nhiệm vụ của bạn là dựa vào toàn bộ kịch bản lời thoại của video dưới đây để sáng tạo một bài đăng hoàn chỉnh, thu hút lượng tương tác và chia sẻ khổng lồ.\n\n"
            f"{selected_style_guide}\n\n"
            "YÊU CẦU ĐỊNH DẠNG ĐẦU RA (BẮT BUỘC TRẢ VỀ DUY NHẤT ĐỊNH DẠNG JSON HỢP LỆ, KHÔNG KÈM LỜI DẪN NGOÀI):\n"
            "{\n"
            '  "titles": [\n'
            '    "Tiêu đề 1 (Giật tít, có emoji)",\n'
            '    "Tiêu đề 2 (Tò mò, kích thích tranh luận)",\n'
            '    "Tiêu đề 3 (Trực diện, đánh trúng tâm lý)"\n'
            "  ],\n"
            '  "caption": "Nội dung bài viết hoàn chỉnh gồm: Câu mở đầu cuốn hút -> Nội dung phân tích/trải nghiệm -> Kêu gọi hành động (Call To Action: bình luận, chia sẻ, đặt mua) kèm icon emoji sinh động, ngắt dòng thoáng mắt dễ đọc trên điện thoại.",\n'
            '  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"]\n'
            "}\n"
        )

        user_content = f"KỊCH BẢN VIDEO LỒNG TIẾNG:\n\"\"\"\n{transcript_text[:4000]}\n\"\"\""
        if custom_instructions:
            user_content += f"\n\nYÊU CẦU BỔ SUNG TỪ NGƯỜI DÙNG: {custom_instructions}"

        native_base = "https://generativelanguage.googleapis.com"
        endpoint = f"{native_base}/v1beta/interactions"
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": effective_key,
            "Api-Revision": "2026-05-20"
        }

        full_prompt = f"{system_instruction}\n\n{user_content}"
        payload = {
            "model": f"models/{effective_model}",
            "input": full_prompt
        }

        safe_log(f"[CaptionGenerator] Đang gọi Gemini ({effective_model}) tạo caption Fanpage style '{style}'...")

        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(endpoint, json=payload, headers=headers)
            if res.status_code != 200:
                # Fallback qua generateContent thông thường nếu interactions không hỗ trợ
                fb_endpoint = f"{native_base}/v1beta/models/{effective_model}:generateContent?key={effective_key}"
                res = await client.post(fb_endpoint, json={"contents": [{"parts": [{"text": full_prompt}]}]})
                if res.status_code != 200:
                    raise RuntimeError(f"Gemini API Error ({res.status_code}): {res.text}")
                res_data = res.json()
                raw_text = res_data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
            else:
                res_json = res.json()
                raw_text = ""
                for step in res_json.get("steps", []):
                    if step.get("type") == "model_output":
                        parts = step.get("content", [])
                        if parts and isinstance(parts[0], dict):
                            raw_text = parts[0].get("text", "")
                        elif parts and isinstance(parts[0], str):
                            raw_text = parts[0]
                        break
                if not raw_text:
                    raw_text = res_json.get("output_text") or res_json.get("output") or ""

        # Parse JSON từ output của Gemini
        return cls._parse_gemini_json_output(raw_text)

    @classmethod
    def _parse_gemini_json_output(cls, raw_text: str) -> Dict[str, Any]:
        """Tách và phân tích chuỗi JSON trả về từ Gemini một cách an toàn."""
        cleaned = raw_text.strip()
        # Loại bỏ markdown code block nếu có
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r"\s*```$", "", cleaned)
            cleaned = cleaned.strip()

        try:
            data = json.loads(cleaned)
            titles = data.get("titles", [])
            caption = data.get("caption", "").strip()
            hashtags = data.get("hashtags", [])

            if not isinstance(titles, list):
                titles = [str(titles)]
            if not isinstance(hashtags, list):
                hashtags = [str(hashtags)]

            # Tạo bài đăng hoàn chỉnh ghép sẵn
            chosen_title = titles[0] if titles else "🔥 VIDEO ĐẶC SẮC ĐỪNG BỎ LỠ!"
            hashtag_str = " ".join(hashtags)
            full_post = f"{chosen_title}\n\n{caption}\n\n{hashtag_str}".strip()

            return {
                "success": True,
                "titles": titles,
                "caption": caption,
                "hashtags": hashtags,
                "full_post": full_post
            }
        except Exception as e:
            safe_log(f"[CaptionGenerator] Parse JSON lỗi ({e}), fallback sang định dạng văn bản thô...")
            # Fallback nếu model trả về text thường
            lines = [l.strip() for l in raw_text.splitlines() if l.strip()]
            titles = [lines[0]] if lines else ["🔥 VIDEO HAY XEM NGAY!"]
            caption = "\n".join(lines[1:]) if len(lines) > 1 else raw_text
            hashtags = ["#review", "#xuhuong", "#video", "#reels", "#facebook"]
            return {
                "success": True,
                "titles": titles,
                "caption": caption,
                "hashtags": hashtags,
                "full_post": f"{titles[0]}\n\n{caption}\n\n{' '.join(hashtags)}"
            }

    @classmethod
    async def generate_affiliate_comments(
        cls,
        transcript_text: str,
        affiliate_link: str = "",
        custom_instructions: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Gọi Google Gemini để tạo 3-4 đoạn bình luận (Comment ghim) tự nhiên, ngắn gọn, cuốn hút
        dùng để dán link tiếp thị liên kết (Shopee, TikTok Shop, Lazada...) dưới bài viết Fanpage.
        """
        effective_key = (
            api_key
            or GEMINI_API_KEY
            or AI_TRANSLATE_API_KEY
            or os.getenv("GEMINI_API_KEY", "")
            or os.getenv("GOOGLE_API_KEY", "")
            or ""
        ).strip()

        effective_model = (
            model
            or GEMINI_MODEL
            or AI_TRANSLATE_MODEL
            or "gemini-2.5-flash"
        ).strip()

        if not effective_key:
            raise ValueError("Chưa cấu hình Google Gemini API Key.")

        system_instruction = (
            "Bạn là Chuyên gia Affiliate Marketing & Content Creator bậc thầy trên Facebook Fanpage và TikTok Shop.\n"
            "Nhiệm vụ: Dựa vào kịch bản video lồng tiếng và link sản phẩm được cung cấp, hãy viết 3 ĐOẠN COMMENT KHÁC NHAU "
            "dùng để người đăng bài ghim lên đầu phần bình luận (Pinned Comment) nhằm chuyển đổi người xem thành người mua hàng.\n\n"
            "YÊU CẦU ĐOẠN COMMENT:\n"
            "1. Tự nhiên, ngắn gọn (chỉ 2-3 câu), thân thiện như người dùng thật đang chia sẻ link cho bạn bè.\n"
            "2. Nhắc đúng tên/công dụng độc đáo của sản phẩm trong video.\n"
            "3. Có icon chỉ tay xuống 👇, lời giục mua nhẹ nhàng ('đang có mã giảm giá', 'ai cần tự lấy nha', 'để sẵn link ở đây').\n"
            f"4. BẮT BUỘC chèn đường link sau vào vị trí hợp lý: {affiliate_link or '[LINK_SẢN_PHẨM]'}\n"
            "5. Thêm 2-3 hashtag ngắn gọn ở cuối comment.\n\n"
            "YÊU CẦU ĐỊNH DẠNG ĐẦU RA (BẮT BUỘC TRẢ VỀ DUY NHẤT JSON HỢP LỆ, KHÔNG LỜI DẪN NGOÀI):\n"
            "{\n"
            '  "comments": [\n'
            '    "Đoạn comment 1 hoàn chỉnh kèm link...",\n'
            '    "Đoạn comment 2 hoàn chỉnh kèm link...",\n'
            '    "Đoạn comment 3 hoàn chỉnh kèm link..."\n'
            "  ]\n"
            "}\n"
        )

        user_content = f"KỊCH BẢN VIDEO:\n\"\"\"\n{transcript_text[:3500]}\n\"\"\"\n\nLINK TIẾP THỊ LIÊN KẾT: {affiliate_link or 'https://s.shopee.vn/link-san-pham'}"
        if custom_instructions:
            user_content += f"\n\nGHI CHÚ THÊM TỪ NGƯỜI DÙNG: {custom_instructions}"

        native_base = "https://generativelanguage.googleapis.com"
        endpoint = f"{native_base}/v1beta/interactions"
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": effective_key,
            "Api-Revision": "2026-05-20"
        }

        full_prompt = f"{system_instruction}\n\n{user_content}"
        payload = {
            "model": f"models/{effective_model}",
            "input": full_prompt
        }

        safe_log(f"[CaptionGenerator] Đang gọi Gemini ({effective_model}) tạo Comment ghim link tiếp thị...")

        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(endpoint, json=payload, headers=headers)
            if res.status_code != 200:
                fb_endpoint = f"{native_base}/v1beta/models/{effective_model}:generateContent?key={effective_key}"
                res = await client.post(fb_endpoint, json={"contents": [{"parts": [{"text": full_prompt}]}]})
                if res.status_code != 200:
                    raise RuntimeError(f"Gemini API Error ({res.status_code}): {res.text}")
                res_data = res.json()
                raw_text = res_data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
            else:
                res_json = res.json()
                raw_text = ""
                for step in res_json.get("steps", []):
                    if step.get("type") == "model_output":
                        parts = step.get("content", [])
                        if parts and isinstance(parts[0], dict):
                            raw_text = parts[0].get("text", "")
                        elif parts and isinstance(parts[0], str):
                            raw_text = parts[0]
                        break
                if not raw_text:
                    raw_text = res_json.get("output_text") or res_json.get("output") or ""

        # Parse output JSON
        cleaned = raw_text.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r"\s*```$", "", cleaned)
            cleaned = cleaned.strip()

        try:
            parsed = json.loads(cleaned)
            comments = parsed.get("comments", [])
            if not isinstance(comments, list):
                comments = [str(comments)]
            return {"success": True, "comments": comments}
        except Exception:
            # Fallback nếu không parse được JSON
            fallback_comment = (
                f"🔥 Link mua sản phẩm như trên video em để sẵn ở đây nha cả nhà 👇\n"
                f"Ai cần bấm vào xem chi tiết nhé, giá đang rất tốt luôn 🥰\n"
                f"🔗 {affiliate_link or 'https://s.shopee.vn/link-san-pham'}\n"
                f"#review #sanphamtiendun #giadung"
            )
            return {"success": True, "comments": [fallback_comment]}
