import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Badge, Card, Empty, Spinner } from "../components/ui";

interface SettingsData {
  app_name: string;
  gateway_base_url: string;
  provider_count: number;
  providers: Array<{
    id: string;
    name: string;
    type: string;
    enabled: boolean;
    secret_configured: boolean;
  }>;
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<SettingsData>("/api/settings")
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, []);

  if (!data && !error) return <Spinner />;
  if (error) return <div className="text-red-600">{error}</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">设置</h1>
      <Card title="网关信息">
        <dl className="space-y-2 text-sm">
          <div className="flex gap-2"><dt className="w-32 text-slate-500">应用名称</dt><dd>{data?.app_name}</dd></div>
          <div className="flex gap-2"><dt className="w-32 text-slate-500">Gateway Base URL</dt><dd className="font-mono text-blue-700">{data?.gateway_base_url || "未设置"}</dd></div>
          <div className="flex gap-2"><dt className="w-32 text-slate-500">Provider 数量</dt><dd>{data?.provider_count}</dd></div>
        </dl>
      </Card>

      <Card title="Provider 概览">
        {data?.providers?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th>名称</th>
                <th>类型</th>
                <th>状态</th>
                <th>Secret</th>
              </tr>
            </thead>
            <tbody>
              {data.providers.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="py-2 font-medium">{p.name}</td>
                  <td>{p.type}</td>
                  <td>{p.enabled ? <Badge tone="green">启用</Badge> : <Badge tone="red">禁用</Badge>}</td>
                  <td>{p.secret_configured ? <Badge tone="green">已配置</Badge> : <Badge tone="red">未配置</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty text="暂无 Provider" />}
      </Card>
    </div>
  );
}
