/**
 * 简卡铺 · 系统日志
 * ---------------------------------------------------------------------------
 * 展示进程内存缓冲里的运行时日志（定时清理、通知发送、接口异常等），
 * 与「操作日志」（管理员写操作审计）互补。日志存内存环形缓冲，
 * 进程重启后清空——排查线上问题的第一时间点开这里看。
 */
import { useMemo, useState } from "react";
import { api } from "../../shared/api";
import { useAsync, useInterval } from "../../shared/hooks";
import { StatusTag, TableEmpty, TableSkeleton } from "../../shared/components";
import type { RuntimeLogEntry } from "../../shared/types";

const LEVEL_LABEL: Record<RuntimeLogEntry["level"], string> = {
  info: "信息",
  warn: "警告",
  error: "错误",
};

function levelTone(level: RuntimeLogEntry["level"]) {
  if (level === "error") return "danger";
  if (level === "warn") return "warn";
  return "off";
}

export function SystemLogsPage() {
  const [level, setLevel] = useState("");
  /* 每 10 秒自动刷新一次，像 tail -f 一样看系统在发生什么 */
  const [tick, setTick] = useState(0);
  const [limit, setLimit] = useState(200);

  useInterval(() => setTick((t) => t + 1), 10_000);

  const { data, loading, error, reload } = useAsync(
    (signal) => api.admin.systemLogs({ limit }, signal),
    [tick, limit]
  );

  const rows = useMemo(() => {
    const all = data?.logs ?? [];
    if (!level) return all;
    return all.filter((l: RuntimeLogEntry) => l.level === level);
  }, [data, level]);

  return (
    <>
      <div className="toolbar-2">
        <select
          className="select select-sm"
          style={{ minWidth: 140 }}
          aria-label="按级别筛选"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        >
          <option value="">全部级别</option>
          <option value="error">错误</option>
          <option value="warn">警告</option>
          <option value="info">信息</option>
        </select>

        <select
          className="select select-sm"
          style={{ minWidth: 130 }}
          aria-label="显示条数"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
        >
          <option value={100}>最近 100 条</option>
          <option value={200}>最近 200 条</option>
          <option value={500}>最近 500 条</option>
        </select>

        <span className="result-count">
          {data ? `共缓冲 ${data.logs.length} 条，每 10 秒自动刷新` : ""}
        </span>

        <div className="spacer" />
        <button className="btn btn-ghost" onClick={() => void reload()}>
          ↻ 立即刷新
        </button>
      </div>

      <section className="block">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 170 }}>时间</th>
                <th style={{ width: 90 }}>级别</th>
                <th>内容</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={3} height={200} />}
              {!loading && error && <TableEmpty cols={3} icon="🔌" text={error} />}
              {!loading && !error && rows.length === 0 && (
                <TableEmpty cols={3} icon="🧾" text="暂无日志记录" />
              )}

              {!loading &&
                rows.map((l: RuntimeLogEntry, i: number) => (
                  <tr key={`${l.time}-${i}`}>
                    <td className="nowrap dim mono">{l.time.replace("T", " ").replace(/\..+Z$/, "")}</td>
                    <td className="nowrap">
                      <StatusTag text={LEVEL_LABEL[l.level]} tone={levelTone(l.level)} />
                    </td>
                    <td>
                      <div
                        className={l.level === "error" ? "mono" : "mono dim"}
                        style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 12.5 }}
                        title={l.message}
                      >
                        {l.message}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="small dim mt-16">
        系统日志存放在进程内存中（最多 500 条），重启后清空；部署平台的容器输出里保留完整历史。
        <br />
        接口异常、通知发送失败、定时任务结果都会记录在这里——排查「为什么发不出邮件」等问题的第一现场。
      </p>
    </>
  );
}

export default SystemLogsPage;