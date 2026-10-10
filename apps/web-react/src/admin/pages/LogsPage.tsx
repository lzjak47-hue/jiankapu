/**
 * 简卡铺 · 操作日志
 */
import { useState } from "react";
import { api } from "../../shared/api";
import { useAsync, useDebouncedValue } from "../../shared/hooks";
import { Pagination, StatusTag, TableEmpty, TableSkeleton } from "../../shared/components";

const PER_PAGE = 10;

export function LogsPage() {
  const [keyword, setKeyword] = useState("");
  const [result, setResult] = useState("");
  const [page, setPage] = useState(1);
  const debouncedKeyword = useDebouncedValue(keyword);

  const { data, loading, error } = useAsync(
    (signal) => api.admin.logs({ keyword: debouncedKeyword, result, page, perPage: PER_PAGE }, signal),
    [debouncedKeyword, result, page]
  );

  return (
    <>
      <div className="toolbar-2">
        <div className="search-box grow">
          <span className="ico">🔍</span>
          <input
            className="input"
            placeholder="搜索操作内容 / 目标 / 操作人"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <select
          className="select select-sm"
          value={result}
          onChange={(e) => {
            setResult(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部结果</option>
          <option value="成功">成功</option>
          <option value="失败">失败</option>
        </select>
      </div>

      <section className="block">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作人</th>
                <th>操作</th>
                <th>目标</th>
                <th>IP</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={6} height={200} />}
              {!loading && error && <TableEmpty cols={6} icon="🔌" text={error} />}
              {!loading && !error && (data?.rows.length ?? 0) === 0 && (
                <TableEmpty cols={6} icon="📜" text="没有符合条件的日志" />
              )}

              {!loading &&
                data?.rows.map((l) => (
                  <tr key={l.id}>
                    <td className="nowrap dim">{l.time}</td>
                    <td className="nowrap">{l.actor}</td>
                    <td className="nowrap">{l.action}</td>
                    <td className="mono nowrap">{l.target || "—"}</td>
                    <td className="nowrap dim">{l.ip || "—"}</td>
                    <td>
                      <StatusTag text={l.result} tone={l.result === "成功" ? "on" : "danger"} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {data && (
          <Pagination page={data.page} perPage={data.perPage} total={data.total} onChange={setPage} />
        )}
      </section>

      <p className="small dim mt-16">
        操作人为 <code>system</code> 的记录由系统自动任务产生（自动发货、库存锁定、超时关单等）。
      </p>
    </>
  );
}

export default LogsPage;
