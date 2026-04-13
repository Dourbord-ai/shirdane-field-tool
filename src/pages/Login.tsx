import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { loginApi, saveSession } from "@/lib/auth";
import holsteinBg from "@/assets/holstein-bg.jpg";

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!username.trim() || !password.trim()) {
      setError("لطفاً تمام فیلدها را پر کنید");
      return;
    }

    // Hardcoded alternative login
    if (username.trim() === "admin" && password === "rezghi") {
      saveSession("local-dev-token", { id: "1", name: "مدیر سیستم", username: "admin" });
      navigate("/dashboard", { replace: true });
      return;
    }

    setLoading(true);
    try {
      const res = await loginApi({ username: username.trim(), password });
      if (res.success && res.token && res.user) {
        saveSession(res.token, res.user);
        navigate("/dashboard", { replace: true });
      } else {
        setError(res.error || "خطا در ورود");
      }
    } catch {
      setError("خطا در ارتباط با سرور");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background image with low opacity */}
      <img
        src={holsteinBg}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover opacity-10 pointer-events-none select-none"
        width={768}
        height={1024}
      />

      <div className="w-full max-w-sm animate-fade-in relative z-10">
        {/* Brand */}
        <div className="text-center mb-10">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <span className="text-heading-lg text-primary">🐄</span>
          </div>
          <h1 className="text-heading-lg text-foreground">شیردانه</h1>
          <p className="text-body text-muted-foreground mt-1">کشت و صنعت</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="username" className="block text-body font-medium mb-2">
              نام کاربری
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full touch-target rounded-lg border border-input bg-card/90 backdrop-blur-sm px-4 py-3 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
              placeholder="مثال: admin"
              dir="ltr"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-body font-medium mb-2">
              رمز عبور
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPass ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full touch-target rounded-lg border border-input bg-card/90 backdrop-blur-sm px-4 py-3 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-shadow pl-12"
                placeholder="رمز عبور"
                dir="ltr"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute left-2 top-1/2 -translate-y-1/2 touch-target flex items-center justify-center text-muted-foreground"
                aria-label={showPass ? "مخفی کردن رمز" : "نمایش رمز"}
              >
                {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-destructive text-body animate-fade-in">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full touch-target rounded-lg bg-primary text-primary-foreground font-bold text-body-lg py-3.5 active:scale-[0.98] transition-transform disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin-slow" />
                در حال ورود...
              </>
            ) : (
              "ورود"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
