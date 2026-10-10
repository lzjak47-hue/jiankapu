/**
 * 简卡铺 · 商品新增 / 编辑
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../shared/api";
import { money } from "../../shared/format";
import { useAsync } from "../../shared/hooks";
import { Skeleton, Switch } from "../../shared/components";
import { useToast } from "../../shared/ToastProvider";
import type { ProductInput } from "../../shared/types";

const EMPTY_FORM: ProductInput = {
  name: "",
  category: "",
  emoji: "📦",
  price: 0,
  oldPrice: 0,
  badge: "",
  status: 1,
  specs: [],
  desc: "",
  detail: "",
  notice: [],
  tutorial: [],
};

/** 规格 chip 输入：回车添加、✕ 删除、退格回删 */
function SpecChips({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v) return;
    if (value.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...value, v]);
    setDraft("");
  }

  return (
    <div className="chip-input">
      {value.map((s, i) => (
        <span className="chip" key={s}>
          {s}
          <button
            type="button"
            aria-label={`删除规格 ${s}`}
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
          >
            ✕
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder="输入规格后按回车添加，例如「月卡」"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

export function ProductEditPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState<ProductInput>(EMPTY_FORM);
  const [newId, setNewId] = useState(`p${String(Date.now()).slice(-6)}`);
  const [saving, setSaving] = useState(false);

  const categories = useAsync((signal) => api.admin.categories(signal), []);

  const { data: existing, loading, error } = useAsync(
    (signal) => (isNew ? Promise.resolve(null) : api.admin.product(id!, signal)),
    [id, isNew]
  );

  /* 载入已有商品后填充表单 */
  useEffect(() => {
    if (!existing) return;
    setForm({
      name: existing.name,
      category: existing.category,
      emoji: existing.emoji,
      price: existing.price,
      oldPrice: existing.oldPrice,
      badge: existing.badge,
      status: existing.status,
      specs: [...existing.specs],
      desc: existing.desc,
      detail: existing.detail,
      notice: [...existing.notice],
      tutorial: [...existing.tutorial],
    });
  }, [existing]);

  /* 新增时默认选中第一个可用分类 */
  useEffect(() => {
    if (!isNew) return;
    const first = categories.data?.rows.find((c) => c.status);
    if (first) setForm((f) => (f.category ? f : { ...f, category: first.id }));
  }, [isNew, categories.data]);

  const patch = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const previewPrice = useMemo(() => money(form.price), [form.price]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.name.trim()) {
      toast.warn("请填写商品名称");
      return;
    }
    if (!(form.price > 0)) {
      toast.warn("请填写正确的售价");
      return;
    }
    if (!form.category) {
      toast.warn("请选择所属分类");
      return;
    }

    setSaving(true);
    try {
      const saved = isNew
        ? await api.admin.createProduct({ ...form, id: newId.trim() })
        : await api.admin.updateProduct(id!, form);
      toast.success(isNew ? `商品已创建：${saved.name}` : `已保存：${saved.name}`);
      setTimeout(() => navigate("/products"), 600);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
      setSaving(false);
    }
  }

  if (!isNew && loading) {
    return (
      <div className="edit-layout">
        <Skeleton height={520} />
        <Skeleton height={320} />
      </div>
    );
  }

  if (!isNew && error) {
    return (
      <div className="block">
        <div className="block-body">
          <p className="muted">{error}</p>
          <Link className="btn btn-primary mt-16" to="/products">
            返回商品列表
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="breadcrumb">
        <Link to="/products">商品管理</Link>
        <span className="sep">/</span>
        <span>{isNew ? "新增商品" : `编辑商品 · ${existing?.name ?? ""}`}</span>
      </div>

      <div className="edit-layout">
        <div>
          {/* 基础信息 */}
          <section className="block">
            <div className="block-head">
              <h3>基础信息</h3>
            </div>
            <div className="block-body">
              <div className="form-grid">
                <div className="field col-span-2">
                  <label htmlFor="f-name">
                    商品名称 <span className="req">*</span>
                  </label>
                  <input
                    id="f-name"
                    className="input"
                    value={form.name}
                    placeholder="例如：爱奇艺黄金 VIP 会员"
                    onChange={(e) => patch("name", e.target.value)}
                  />
                  <div className="desc">建议写清「品牌 + 权益 + 时长」，例如「腾讯视频 VIP 会员 月卡」。</div>
                </div>

                <div className="field">
                  <label htmlFor="f-id">商品 ID</label>
                  <input
                    id="f-id"
                    className="input"
                    value={isNew ? newId : (existing?.id ?? "")}
                    readOnly={!isNew}
                    onChange={(e) => setNewId(e.target.value)}
                  />
                  <div className="desc">用于订单与卡密关联，创建后不建议修改。</div>
                </div>

                <div className="field">
                  <label htmlFor="f-category">
                    所属分类 <span className="req">*</span>
                  </label>
                  <select
                    id="f-category"
                    className="select"
                    value={form.category}
                    onChange={(e) => patch("category", e.target.value)}
                  >
                    <option value="">请选择分类</option>
                    {(categories.data?.rows ?? [])
                      .filter((c) => c.status || c.id === form.category)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="f-price">
                    售价（元） <span className="req">*</span>
                  </label>
                  <input
                    id="f-price"
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.price || ""}
                    placeholder="12.80"
                    onChange={(e) => patch("price", Number(e.target.value))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="f-old-price">划线价（元）</label>
                  <input
                    id="f-old-price"
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.oldPrice || ""}
                    placeholder="选填，用于显示原价"
                    onChange={(e) => patch("oldPrice", Number(e.target.value))}
                  />
                  <div className="desc">填了会显示删除线原价，配合售价制造优惠感。</div>
                </div>

                <div className="field">
                  <label htmlFor="f-emoji">封面占位符号</label>
                  <input
                    id="f-emoji"
                    className="input"
                    maxLength={4}
                    value={form.emoji}
                    placeholder="🎬"
                    onChange={(e) => patch("emoji", e.target.value)}
                  />
                  <div className="desc">演示用 emoji。正式环境请改为上传商品图片。</div>
                </div>

                <div className="field">
                  <label htmlFor="f-badge">角标文案</label>
                  <input
                    id="f-badge"
                    className="input"
                    maxLength={6}
                    value={form.badge}
                    placeholder="热销 / 秒发 / 省钱"
                    onChange={(e) => patch("badge", e.target.value)}
                  />
                  <div className="desc">留空则不显示角标。</div>
                </div>
              </div>
            </div>
          </section>

          {/* 规格与状态 */}
          <section className="block mt-16">
            <div className="block-head">
              <h3>规格与状态</h3>
            </div>
            <div className="block-body">
              <div className="field">
                <label>可选规格</label>
                <SpecChips value={form.specs} onChange={(next) => patch("specs", next)} />
                <div className="desc">支持多规格，前台会让用户选择。留空表示该商品无规格。</div>
              </div>

              <div className="switch-row">
                <div className="txt">
                  <div className="t1">立即上架</div>
                  <div className="t2">关闭后该商品在前台隐藏，已产生的订单不受影响。</div>
                </div>
                <Switch
                  checked={form.status === 1}
                  onChange={(next) => patch("status", next ? 1 : 0)}
                  label="立即上架"
                />
              </div>
            </div>
          </section>

          {/* 文案内容 */}
          <section className="block mt-16">
            <div className="block-head">
              <h3>文案内容</h3>
            </div>
            <div className="block-body">
              <div className="form-grid">
                <div className="field col-span-2">
                  <label htmlFor="f-desc">一句话卖点</label>
                  <input
                    id="f-desc"
                    className="input"
                    value={form.desc}
                    placeholder="支持手机 / 平板 / 电脑，下单后系统自动发货。"
                    onChange={(e) => patch("desc", e.target.value)}
                  />
                  <div className="desc">显示在商品卡片和详情页顶部，控制在一行内最清爽。</div>
                </div>

                <div className="field col-span-2">
                  <label htmlFor="f-detail">商品详情</label>
                  <textarea
                    id="f-detail"
                    className="textarea"
                    value={form.detail}
                    placeholder="详细介绍商品权益、适用范围、渠道来源等"
                    onChange={(e) => patch("detail", e.target.value)}
                  />
                </div>

                <div className="field col-span-2">
                  <label htmlFor="f-notice">购买须知（每行一条）</label>
                  <textarea
                    id="f-notice"
                    className="textarea"
                    value={form.notice.join("\n")}
                    placeholder={"卡密为虚拟商品，一经发货不支持退换。\n请在 24 小时内完成激活。"}
                    onChange={(e) =>
                      patch("notice", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))
                    }
                  />
                  <div className="desc">每行一条，前台会渲染成列表。</div>
                </div>

                <div className="field col-span-2">
                  <label htmlFor="f-tutorial">使用教程（每行一步）</label>
                  <textarea
                    id="f-tutorial"
                    className="textarea"
                    value={form.tutorial.join("\n")}
                    placeholder={"付款成功后，页面会自动展示卡密。\n打开 App → 我的 → 会员中心 → 兑换会员。"}
                    onChange={(e) =>
                      patch("tutorial", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))
                    }
                  />
                  <div className="desc">每行一步，前台会自动编号。</div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* 预览 */}
        <div className="preview-sticky">
          <section className="block">
            <div className="block-head">
              <div>
                <h3>前台预览</h3>
                <div className="sub">输入时实时更新</div>
              </div>
            </div>
            <div className="block-body">
              <div className="card" style={{ pointerEvents: "none" }}>
                <div className="card-media">
                  <span className="thumb-emoji">{form.emoji || "📦"}</span>
                  {form.badge && <span className="tag tag-accent badge">{form.badge}</span>}
                </div>
                <div className="card-body">
                  <div className="card-title">{form.name || "商品名称"}</div>
                  <div className="card-meta">{form.desc || "一句话卖点会显示在这里"}</div>
                  <div className="card-foot">
                    <div className="price">
                      <span className="cur">¥</span>
                      <span className="val">{form.price > 0 ? previewPrice : "0.00"}</span>
                      {form.oldPrice > 0 && <span className="old">¥{money(form.oldPrice)}</span>}
                    </div>
                    <span className="btn btn-primary btn-sm">立即购买</span>
                  </div>
                </div>
              </div>

              <div className="notice" style={{ marginTop: 16 }}>
                <span>👀</span>
                <span>这是商品在首页列表中的样子。真正上线前请把封面换成真实商品图。</span>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* 保存条 */}
      <div className="save-bar">
        <span className="hint">
          带 <span className="req">*</span> 为必填项
        </span>
        <div className="right">
          <button className="btn btn-ghost" type="button" onClick={() => navigate("/products")}>
            取消
          </button>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "保存中…" : "保存商品"}
          </button>
        </div>
      </div>
    </form>
  );
}

export default ProductEditPage;
