import { useState } from "react";
import { Plus, PlugZap, Pencil, Trash2, Check } from "lucide-react";
import { api, type ProviderInput, type PublicProvider } from "../api.js";
import { useFetch } from "../hooks.js";
import {
  Button,
  ChoiceSelect,
  ConfirmAction,
  DialogFrame,
  Input,
  NumberInput,
  CheckField,
} from "../components/controls.js";

const PROTOCOLS = [
  { value: "chat" as const, label: "OpenAI 兼容" },
  { value: "claude" as const, label: "Anthropic Messages" },
  { value: "gemini" as const, label: "Gemini 原生" },
];
const ENDPOINTS = {
  chat: "https://api.openai.com/v1",
  claude: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};
export function Providers(): React.ReactElement {
  const data = useFetch(api.providers);
  const [form, setForm] = useState<ProviderInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const view = data.data;
  const perform = async (work: () => Promise<unknown>, message?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      if (message) setNotice(message);
      data.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!form || busy) return;
    await perform(async () => {
      await api.saveProvider(form);
      setForm(null);
    }, "配置已保存；设为默认后，新任务会使用它。");
  };
  const edit = (p?: PublicProvider) => {
    setError(null);
    setForm(
      p
        ? { ...p, apiKey: "" }
        : {
            name: "",
            protocol: "chat",
            baseURL: ENDPOINTS.chat,
            model: "",
            apiKey: "",
            jsonMode: "json_schema",
            thinking: "default",
            reasoningEffort: "default",
            stream: "auto",
            includeUsage: true,
            timeoutMs: 300000,
          },
    );
  };
  return (
    <section className="providers-page">
      <header className="section-head">
        <div>
          <h1>AI 供应商</h1>
          <p className="muted">
            选择对话和创作使用的模型。正在执行的任务保持原配置，新任务使用当前默认。
          </p>
        </div>
        <Button icon={<Plus />} disabled={busy || !view} onClick={() => edit()}>
          添加供应商
        </Button>
      </header>
      <p className="providers-help">
        密钥仅保存在本机服务端，不回显到页面，也不随作品备份导出。连接测试会发送一条简短请求，用量计入当前作品。
      </p>
      {notice && (
        <p role="status" className="finding" data-level="info">
          {notice}
        </p>
      )}
      {error && !form && (
        <p role="alert" className="finding" data-level="block">
          {error}
        </p>
      )}
      {data.error && (
        <p role="alert">
          {data.error}
          <Button onClick={data.reload}>重新加载</Button>
        </p>
      )}
      {!view && !data.error && <p role="status">正在读取模型配置…</p>}
      {view && (
        <div className="provider-list">
          <section className="provider-row" aria-label="环境变量配置">
            <div className="provider-detail">
              <h2>
                环境变量配置
                {view.activeId === "environment" && (
                  <span className="provider-active">
                    <Check aria-hidden="true" />
                    当前默认
                  </span>
                )}
              </h2>
              <p>
                {view.environment.protocol} ·{" "}
                {view.environment.model || "未指定模型"}
              </p>
              <p className="muted">
                {view.environment.configured
                  ? "沿用启动服务时的配置，页面不会覆盖环境变量。"
                  : "尚未配置完整，可添加供应商后设为默认。"}
              </p>
              {view.environment.baseURL && (
                <p className="provider-endpoint">{view.environment.baseURL}</p>
              )}
            </div>
            <div className="provider-actions">
              <Button
                disabled={busy || !view.environment.configured}
                onClick={() =>
                  void perform(
                    () => api.copyEnvironmentProvider(),
                    "环境配置已复制，密钥由服务端保留；可编辑副本后设为默认。",
                  )
                }
              >
                复制为可编辑配置
              </Button>
              <Button
                disabled={busy || !view.environment.configured}
                icon={<PlugZap />}
                onClick={() =>
                  void perform(async () => {
                    const r = await api.testProvider("environment");
                    setNotice(r.message);
                  })
                }
              >
                测试连接
              </Button>
              <Button
                disabled={
                  busy ||
                  !view.environment.configured ||
                  view.activeId === "environment"
                }
                onClick={() =>
                  void perform(
                    () => api.selectProvider("environment"),
                    "已切换到环境变量配置。",
                  )
                }
              >
                使用环境配置
              </Button>
            </div>
          </section>
          {view.profiles.map((p) => (
            <section key={p.id} className="provider-row" aria-label={p.name}>
              <div className="provider-detail">
                <h2>
                  {p.name}
                  {view.activeId === p.id && (
                    <span className="provider-active">
                      <Check aria-hidden="true" />
                      当前默认
                    </span>
                  )}
                </h2>
                <p>
                  {PROTOCOLS.find((v) => v.value === p.protocol)?.label} ·{" "}
                  {p.model}
                  {p.judgeModel && p.judgeModel !== p.model
                    ? ` / 审查：${p.judgeModel}`
                    : ""}
                </p>
                <p className="provider-endpoint">{p.baseURL}</p>
                <p className="muted">密钥已保存</p>
              </div>
              <div className="provider-actions">
                <Button
                  icon={<PlugZap />}
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const r = await api.testProvider(p.id);
                      setNotice(r.message);
                    })
                  }
                >
                  测试连接
                </Button>
                <Button
                  disabled={busy || view.activeId === p.id}
                  onClick={() =>
                    void perform(
                      () => api.selectProvider(p.id),
                      `已将${p.name}设为默认。`,
                    )
                  }
                >
                  设为默认
                </Button>
                <Button
                  icon={<Pencil />}
                  disabled={busy}
                  onClick={() => edit(p)}
                >
                  编辑
                </Button>
                <ConfirmAction
                  title={`删除供应商“${p.name}”？`}
                  description="删除本机保存的配置与密钥。已有对话、草稿和作品资料保留。"
                  danger
                  onConfirm={() =>
                    void perform(() => api.deleteProvider(p.id), "配置已删除。")
                  }
                >
                  <Button
                    icon={<Trash2 />}
                    disabled={busy || view.activeId === p.id}
                  >
                    删除
                  </Button>
                </ConfirmAction>
              </div>
            </section>
          ))}
        </div>
      )}
      <DialogFrame
        open={form !== null}
        title={form?.id ? "编辑供应商" : "添加供应商"}
        width={600}
        onCancel={() => {
          if (!busy) {
            setForm(null);
            setError(null);
          }
        }}
        onOk={() => void save()}
        okText="保存"
        confirmLoading={busy}
      >
        {form && (
          <div className="provider-form">
            <label>
              配置名称
              <Input
                value={form.name}
                maxLength={80}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：创作中转"
              />
            </label>
            <label>
              接口协议
              <ChoiceSelect
                aria-label="接口协议"
                value={form.protocol}
                options={PROTOCOLS}
                onChange={(protocol) => {
                  const { judgeModel: _judge, ...rest } = form;
                  setForm({
                    ...rest,
                    protocol,
                    baseURL: ENDPOINTS[protocol],
                    model: "",
                  });
                }}
              />
            </label>
            <label>
              API 地址
              <Input
                value={form.baseURL}
                onChange={(e) => setForm({ ...form, baseURL: e.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <p className="muted">
              {form.protocol === "chat"
                ? "填写兼容接口的根地址、/v1 地址或完整 /chat/completions 地址。"
                : form.protocol === "claude"
                  ? "填写 Messages API 的服务根地址，例如 https://api.anthropic.com。"
                  : "填写原生 API 前缀，例如 https://generativelanguage.googleapis.com/v1beta。"}
            </p>
            <label>
              模型 ID
              <Input
                value={form.model}
                maxLength={200}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="填写账户实际可用、支持工具调用的模型 ID"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            {form.protocol === "claude" && (
              <label>
                审查模型 ID（可选）
                <Input
                  value={form.judgeModel ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, judgeModel: e.target.value })
                  }
                  placeholder="留空则与创作模型相同"
                />
              </label>
            )}
            <label>
              API 密钥
              <Input
                type="password"
                value={form.apiKey ?? ""}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder={
                  form.id ? "已保存，留空保留原密钥" : "填写此供应商的 API 密钥"
                }
                autoComplete="new-password"
                spellCheck={false}
              />
            </label>
            <details>
              <summary>高级能力与限额</summary>
              <div className="provider-advanced">
                <label>
                  超时（秒）
                  <NumberInput
                    min={1}
                    max={2147483}
                    value={(form.timeoutMs ?? 300000) / 1000}
                    onChange={(v) =>
                      setForm({ ...form, timeoutMs: (v ?? 300) * 1000 })
                    }
                  />
                </label>
                <label>
                  输出上限（可选）
                  <NumberInput
                    min={1}
                    value={form.maxOutputTokens ?? null}
                    placeholder="沿用任务预算"
                    onChange={(v) => {
                      const { maxOutputTokens: _max, ...rest } = form;
                      setForm(
                        v === null ? rest : { ...rest, maxOutputTokens: v },
                      );
                    }}
                  />
                </label>
                {form.protocol === "chat" && (
                  <>
                    <label>
                      JSON 输出
                      <ChoiceSelect
                        value={form.jsonMode ?? "json_schema"}
                        options={[
                          { value: "json_schema", label: "JSON Schema" },
                          { value: "json_object", label: "JSON Object" },
                          { value: "prompt", label: "仅提示约束" },
                        ]}
                        onChange={(jsonMode) => setForm({ ...form, jsonMode })}
                      />
                    </label>
                    <label>
                      流式响应
                      <ChoiceSelect
                        value={form.stream ?? "auto"}
                        options={[
                          { value: "auto", label: "自动" },
                          { value: "always", label: "始终流式" },
                          { value: "never", label: "禁用流式" },
                        ]}
                        onChange={(stream) => setForm({ ...form, stream })}
                      />
                    </label>
                    <label>
                      DeepSeek 思考扩展
                      <ChoiceSelect
                        value={form.thinking ?? "default"}
                        options={[
                          { value: "default", label: "服务商默认" },
                          { value: "enabled", label: "开启" },
                          { value: "disabled", label: "关闭" },
                        ]}
                        onChange={(thinking) =>
                          setForm({
                            ...form,
                            thinking,
                            reasoningEffort:
                              thinking === "enabled"
                                ? (form.reasoningEffort ?? "default")
                                : "default",
                          })
                        }
                      />
                    </label>
                    {form.thinking === "enabled" && (
                      <label>
                        思考强度
                        <ChoiceSelect
                          value={form.reasoningEffort ?? "default"}
                          options={[
                            { value: "default", label: "默认" },
                            { value: "low", label: "Low" },
                            { value: "high", label: "High" },
                            { value: "max", label: "Max" },
                          ]}
                          onChange={(reasoningEffort) =>
                            setForm({ ...form, reasoningEffort })
                          }
                        />
                      </label>
                    )}
                    <CheckField
                      checked={form.includeUsage ?? true}
                      onChange={(includeUsage) =>
                        setForm({ ...form, includeUsage })
                      }
                    >
                      请求流式用量统计
                    </CheckField>
                    <p className="muted">
                      按供应商实际支持的能力选择。思考扩展采用 DeepSeek
                      格式，不会自动翻译为其他平台的参数。
                    </p>
                  </>
                )}
              </div>
            </details>
            {error && (
              <p role="alert" className="finding" data-level="block">
                {error}
              </p>
            )}
          </div>
        )}
      </DialogFrame>
    </section>
  );
}
