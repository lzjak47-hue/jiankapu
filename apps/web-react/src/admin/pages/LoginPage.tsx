/**
 * 简卡铺 · 后台登录
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../shared/api";
import { useToast } from "../../shared/ToastProvider";
import { Skeleton } from "../../shared/components";
import { useAuth } from "../AuthContext";
import type { Captcha } from "../../shared/types";

const SITE_BASE =
  (typeof window !== "undefined" && window.JKP_RUNTIME?.siteBase) ||
  `http://${window.location.hostname}:2001`;

export function LoginPage() {
  const { admin, loading, setAdmin } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const loadCaptcha = useCallback(async () => {
    try {
      const data = await api.admin.captcha();
      setCaptcha(data);
      setCode("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "验证码加载失败");
    }
  }, [toast]);

  useEffect(() => {
    void loadCaptcha();
  }, [loadCaptcha]);

  /* 已登录直接进后台 */
  useEffect(() => {
    if (!loading && admin) navigate("/", { replace: true });
  }, [admin, loading, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      toast.warn("请输入账号和密码");
      return;
    }
    if (!code.trim()) {
      toast.warn("请输入验证码");
      return;
    }
    if (!captcha) {
      toast.warn("验证码还没加载好，请点击图形刷新");
      return;
    }

    setBusy(true);
    try {
      const data = await api.admin.login({
        username: username.trim(),
        password,
        captchaId: captcha.id,
        captchaCode: code.trim(),
      });
      setAdmin(data.admin);
      navigate("/", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "登录失败");
      void loadCaptcha();
    } finally {
      setBusy(false);
    }
  }

  const captchaSrc = captcha
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(captcha.svg)}`
    : "";

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-head">
          <span className="logo-mark">简</span>
          <h1>简卡铺 · 管理后台</h1>
          <p>请使用管理员账号登录</p>
        </div>

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="login-user">管理员账号</label>
            <input
              id="login-user"
              className="input"
              autoComplete="username"
              placeholder="请输入账号"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="login-pass">登录密码</label>
            <input
              id="login-pass"
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="请输入密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="login-code">验证码</label>
            <div className="captcha-row">
              <input
                id="login-code"
                className="input"
                maxLength={4}
                autoComplete="off"
                placeholder="请输入右侧验证码"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                type="button"
                className="captcha-box"
                title="点击刷新验证码"
                onClick={() => void loadCaptcha()}
              >
                {captchaSrc ? <img src={captchaSrc} alt="验证码" /> : <Skeleton height={46} />}
              </button>
            </div>
          </div>

          <button
            className="btn btn-primary btn-lg btn-block"
            style={{ marginTop: 22 }}
            type="submit"
            disabled={busy}
          >
            {busy ? "登录中…" : "登 录"}
          </button>
        </form>

        <div className="login-tip">
          演示账号：<code>admin</code> &nbsp;密码：<code>123456</code>
          &nbsp;验证码由服务端生成，点击图形可刷新。
          <br />
          正式环境请务必修改默认密码，并在系统设置中开启登录失败锁定。
        </div>

        <p className="small dim" style={{ textAlign: "center", marginTop: 18 }}>
          <a href={SITE_BASE}>← 返回前台站点</a>
        </p>
      </div>
    </div>
  );
}

export default LoginPage;
