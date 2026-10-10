/**
 * 简卡铺 · 顶部公告条
 * 多条公告自动轮播；只有一条时不启动定时器。
 */
import { useEffect, useState } from "react";
import { useSite } from "../SiteContext";

export function AnnouncementBar() {
  const { announcements } = useSite();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (announcements.length < 2) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % announcements.length);
    }, 4200);
    return () => clearInterval(timer);
  }, [announcements.length]);

  if (announcements.length === 0) return null;

  return (
    <div className="announce">
      <div className="container announce-inner">
        <span className="announce-badge">📢 公告</span>
        <div className="announce-track">
          {announcements.map((item, i) => (
            <div className={`announce-item${i === index ? " is-on" : ""}`} key={item.id}>
              🔔<span>{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default AnnouncementBar;
