/**
 * 简卡铺 · 分类管理
 */
import { useState } from "react";
import { api } from "../../shared/api";
import { useAsync } from "../../shared/hooks";
import { Modal, StatusTag, Switch, TableEmpty, TableSkeleton } from "../../shared/components";
import { useToast } from "../../shared/ToastProvider";
import { useConfirm } from "../../shared/ConfirmProvider";
import type { Category } from "../../shared/types";

interface CategoryForm {
  id: string;
  name: string;
  sort: number;
  remark: string;
  status: number;
}

const EMPTY: CategoryForm = { id: "", name: "", sort: 99, remark: "", status: 1 };

export function CategoriesPage() {
  const toast = useToast();
  const confirm = useConfirm();

  const { data, loading, error, reload } = useAsync((signal) => api.admin.categories(signal), []);
  const [editing, setEditing] = useState<CategoryForm | null>(null);

  const isNew = editing !== null && editing.id === "";

  function openNew() {
    setEditing({ ...EMPTY });
  }

  function openEdit(category: Category) {
    setEditing({
      id: category.id,
      name: category.name,
      sort: category.sort,
      remark: category.remark,
      status: category.status,
    });
  }

  async function save() {
    if (!editing) return;
    if (!editing.name.trim()) return toast.warn("请填写分类名称");
    if (!editing.id.trim()) return toast.warn("请填写分类标识");

    try {
      if (isNew) {
        const created = await api.admin.createCategory({
          id: editing.id.trim(),
          name: editing.name.trim(),
          sort: editing.sort,
          status: editing.status,
          remark: editing.remark.trim(),
        });
        toast.success(`已新增分类：${created.name}`);
      } else {
        const updated = await api.admin.updateCategory(editing.id, {
          name: editing.name.trim(),
          sort: editing.sort,
          status: editing.status,
          remark: editing.remark.trim(),
        });
        toast.success(`已保存分类：${updated.name}`);
      }
      setEditing(null);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    }
  }

  async function toggle(category: Category) {
    try {
      const updated = await api.admin.updateCategory(category.id, {
        status: category.status ? 0 : 1,
      });
      toast.success(updated.status ? `已启用：${updated.name}` : `已停用：${updated.name}`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function remove(category: Category) {
    if (category.count > 0) {
      toast.warn(`该分类下还有 ${category.count} 个商品，无法删除`);
      return;
    }
    const ok = await confirm({
      title: "删除分类",
      message: `确定要删除分类「${category.name}」吗？`,
      okText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.admin.deleteCategory(category.id);
      toast.success(`已删除：${category.name}`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  }

  return (
    <>
      <div className="toolbar-2">
        <span className="result-count">排序值越小越靠前；分类下还有商品时不允许删除</span>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={openNew}>
          ＋ 新增分类
        </button>
      </div>

      <section className="block">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>排序</th>
                <th>分类名称</th>
                <th>分类标识</th>
                <th>商品数</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={6} height={160} />}
              {!loading && error && <TableEmpty cols={6} icon="🔌" text={error} />}
              {!loading && !error && (data?.rows.length ?? 0) === 0 && (
                <TableEmpty cols={6} icon="🗂️" text="还没有分类" />
              )}

              {!loading &&
                data?.rows.map((c) => (
                  <tr key={c.id}>
                    <td className="num nowrap">{c.sort}</td>
                    <td>
                      <div className="cell-main">
                        <span className="cell-thumb">🗂️</span>
                        <div>
                          <div className="t1">{c.name}</div>
                          <div className="t2">{c.remark || "—"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono">{c.id}</td>
                    <td className="num nowrap">{c.count} 件</td>
                    <td>
                      <StatusTag text={c.status ? "启用" : "停用"} tone={c.status ? "on" : "off"} />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button onClick={() => openEdit(c)}>编辑</button>
                        <span className="sep" />
                        <button onClick={() => void toggle(c)}>{c.status ? "停用" : "启用"}</button>
                        <span className="sep" />
                        <button className="danger" onClick={() => void remove(c)}>
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="small dim mt-16">
        分类标识（英文 id）会写进商品的 <code>category</code> 字段，创建后不建议随意改动。
      </p>

      {editing && (
        <Modal
          title={isNew ? "新增分类" : "编辑分类"}
          width={440}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn btn-ghost btn-block" onClick={() => setEditing(null)}>
                取消
              </button>
              <button className="btn btn-primary btn-block" onClick={() => void save()}>
                保存
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="cat-name">
              分类名称 <span className="req">*</span>
            </label>
            <input
              id="cat-name"
              className="input"
              placeholder="例如：视频会员"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="cat-id">
              分类标识 <span className="req">*</span>
            </label>
            <input
              id="cat-id"
              className="input"
              placeholder="英文小写，例如 video"
              disabled={!isNew}
              value={editing.id}
              onChange={(e) => setEditing({ ...editing, id: e.target.value })}
            />
            {!isNew && <div className="desc">创建后不可修改。</div>}
          </div>

          <div className="field">
            <label htmlFor="cat-sort">排序值</label>
            <input
              id="cat-sort"
              className="input"
              type="number"
              min={0}
              value={editing.sort}
              onChange={(e) => setEditing({ ...editing, sort: Number(e.target.value) })}
            />
          </div>

          <div className="field">
            <label htmlFor="cat-remark">备注</label>
            <input
              id="cat-remark"
              className="input"
              placeholder="选填，例如：爱奇艺 / 腾讯 / 优酷"
              value={editing.remark}
              onChange={(e) => setEditing({ ...editing, remark: e.target.value })}
            />
          </div>

          <div className="switch-row" style={{ borderBottom: "none" }}>
            <div className="txt">
              <div className="t1">启用该分类</div>
              <div className="t2">停用后前台筛选栏不再显示该分类。</div>
            </div>
            <Switch
              checked={editing.status === 1}
              onChange={(next) => setEditing({ ...editing, status: next ? 1 : 0 })}
              label="启用该分类"
            />
          </div>
        </Modal>
      )}
    </>
  );
}

export default CategoriesPage;
