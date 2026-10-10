/**
 * 简卡铺 · 修改管理员密码
 * ---------------------------------------------------------------------------
 * 后端改完密码会清掉当前会话 Cookie（其它设备的会话也一并失效），
 * 所以成功后要把用户送回登录页，而不是留在一个已经 401 的界面上。
 */
import { useState } from "react";
import { api } from "../../shared/api";
import { Modal } from "../../shared/components";
import { useToast } from "../../shared/ToastProvider";
import { useAuth } from "../AuthContext";

const MIN_LENGTH = 6;

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { admin, logout } = useAuth();

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const tooShort = newPassword.length > 0 && newPassword.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== newPassword;
  const canSubmit =
    oldPassword.length > 0 && newPassword.length >= MIN_LENGTH && confirm === newPassword && !saving;

  async function submit() {
    if (!canSubmit) return;

    /* 新旧密码相同是很常见的误操作，提前拦下 */
    if (oldPassword === newPassword) {
      toast.warn("新密码不能和原密码相同");
      return;
    }

    setSaving(true);
    try {
      await api.admin.changePassword({ oldPassword, newPassword });
      toast.success("密码已修改，请用新密码重新登录");
      onClose();
      /* 服务端已作废当前会话，走一次退出流程把前端状态也清干净 */
      await logout();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "修改失败");
      setSaving(false);
    }
  }

  return (
    <Modal
      title="修改登录密码"
      width={420}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost btn-block" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary btn-block" disabled={!canSubmit} onClick={() => void submit()}>
            {saving ? "提交中…" : "确认修改"}
          </button>
        </>
      }
    >
      <div className="notice" style={{ marginBottom: 18 }}>
        <span>🔐</span>
        <span>
          当前账号：<strong>{admin?.username}</strong>。修改成功后所有已登录的设备都会退出，
          需要用新密码重新登录。
        </span>
      </div>

      <div className="field">
        <label htmlFor="pw-old">原密码</label>
        <input
          id="pw-old"
          className="input"
          type="password"
          autoComplete="current-password"
          placeholder="请输入当前密码"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="pw-new">新密码</label>
        <input
          id="pw-new"
          className="input"
          type="password"
          autoComplete="new-password"
          placeholder={`至少 ${MIN_LENGTH} 位`}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        {tooShort ? (
          <div className="desc" style={{ color: "var(--danger)" }}>
            密码至少 {MIN_LENGTH} 位
          </div>
        ) : (
          <div className="desc">建议同时包含字母与数字，不要用 admin / 123456 这类弱口令。</div>
        )}
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="pw-confirm">确认新密码</label>
        <input
          id="pw-confirm"
          className="input"
          type="password"
          autoComplete="new-password"
          placeholder="再输入一次新密码"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        {mismatch && (
          <div className="desc" style={{ color: "var(--danger)" }}>
            两次输入的密码不一致
          </div>
        )}
      </div>
    </Modal>
  );
}

export default ChangePasswordModal;
