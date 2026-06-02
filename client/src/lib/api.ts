import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clearPersistedAuth, getAccessTokenFromStorage } from "./auth.tsx";

// ---- Types (mirror server JSON shapes) ----

export type ProviderInfo = {
  id: "ollama" | "claude" | "gemini" | "openai";
  configured: boolean;
  models: string[];
  category: "local" | "enterprise";
};

export type ParsedSection = {
  key: string;
  ordinal: number;
  title: string;
  bodyText: string;
  bodyXml: string;
  placeholders: Array<{ token: string; raw: string }>;
};

export type ParsedTemplate = {
  title: string;
  preambleText: string;
  globalPlaceholders: Array<{ token: string; raw: string }>;
  sections: ParsedSection[];
};

export type Template = {
  id: number;
  organization_id: number;
  slug: string;
  title: string;
  parsed: ParsedTemplate;
};

export type Organization = { id: number; slug: string; name: string };

export type Meeting = {
  id: number;
  template_id: number;
  label: string;
  meeting_date: string | null;
  previous_meeting_date: string | null;
  variables: Record<string, string>;
  ai_provider: string | null;
  ai_model: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type Source = {
  id: number;
  meeting_id: number;
  kind: "docx" | "xlsx" | "csv" | "pdf" | "image" | "text";
  label: string | null;
  original_name: string | null;
  mime: string | null;
  extracted_text: string | null;
  created_at: string;
};

export type SectionDraft = {
  id: number;
  meeting_id: number;
  section_key: string;
  ordinal: number;
  title: string;
  content_md: string;
  template_body_text: string;
  preview_md: string;
  template_preview_md: string;
  status: "pending" | "draft" | "approved";
  mode: "template" | "ai";
  required_sources: string[];
  last_ai_provider: string | null;
  last_ai_model: string | null;
  updated_at: string;
};

// ---- Fetch wrapper ----

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAccessTokenFromStorage();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!(init.body instanceof FormData) && init.body) {
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 401 && (err.error === "invalid token" || err.error === "wrong token type" || err.error === "missing token")) {
      clearPersistedAuth();
      if (window.location.pathname !== "/login") window.location.assign("/login");
    }
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function apiBlob(path: string): Promise<Blob> {
  const token = getAccessTokenFromStorage();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(path, { headers });
  if (!res.ok) {
    if (res.status === 401) {
      clearPersistedAuth();
      if (window.location.pathname !== "/login") window.location.assign("/login");
    }
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return await res.blob();
}

// ---- Hooks ----

export function useProviders() {
  return useQuery({
    queryKey: ["ai", "providers"],
    queryFn: () => apiFetch<{ providers: ProviderInfo[] }>("/api/ai/providers"),
    staleTime: 60_000,
  });
}

export function useOrganizations() {
  return useQuery({
    queryKey: ["organizations"],
    queryFn: () => apiFetch<{ organizations: Organization[] }>("/api/organizations"),
    staleTime: 5 * 60_000,
  });
}

export function useTemplates() {
  return useQuery({
    queryKey: ["templates"],
    queryFn: () => apiFetch<{ templates: Template[] }>("/api/templates"),
    staleTime: 5 * 60_000,
  });
}

export function useMeetings() {
  return useQuery({
    queryKey: ["meetings"],
    queryFn: () => apiFetch<{ meetings: Meeting[] }>("/api/meetings"),
  });
}

export function useMeeting(id: number | null) {
  return useQuery({
    queryKey: ["meetings", id],
    queryFn: () => apiFetch<{ meeting: Meeting }>(`/api/meetings/${id}`),
    enabled: id != null,
  });
}

export function useCreateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { template_id: number; label?: string }) =>
      apiFetch<{ meeting: Meeting }>("/api/meetings", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings"] }),
  });
}

export function useUpdateMeeting(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<{
      label: string;
      meeting_date: string;
      previous_meeting_date: string;
      variables: Record<string, string>;
      ai_provider: string;
      ai_model: string;
      status: string;
    }>) =>
      apiFetch<{ meeting: Meeting }>(`/api/meetings/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings", id] });
      qc.invalidateQueries({ queryKey: ["meetings"] });
    },
  });
}

export function useSources(meetingId: number | null, sectionKey?: string) {
  return useQuery({
    queryKey: ["meetings", meetingId, "sources", sectionKey ?? "all"],
    queryFn: () => {
      const path = sectionKey
        ? `/api/meetings/${meetingId}/sources?section_key=${encodeURIComponent(sectionKey)}`
        : `/api/meetings/${meetingId}/sources`;
      return apiFetch<{ sources: Source[] }>(path);
    },
    enabled: meetingId != null,
  });
}

export function useUploadSources(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { files?: FileList | File[]; text?: string; label?: string }) => {
      const fd = new FormData();
      if (vars.label) fd.set("label", vars.label);
      if (vars.text) fd.set("text", vars.text);
      const files = vars.files ? Array.from(vars.files) : [];
      for (const f of files) fd.append("files", f);
      return apiFetch<{ sources: Source[] }>(`/api/meetings/${meetingId}/sources`, {
        method: "POST",
        body: fd,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", meetingId, "sources"] }),
  });
}

export function useDeleteSource(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: number) =>
      apiFetch<{ ok: true }>(`/api/meetings/${meetingId}/sources/${sourceId}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", meetingId, "sources"] }),
  });
}

export function useSections(meetingId: number | null) {
  return useQuery({
    queryKey: ["meetings", meetingId, "sections"],
    queryFn: () => apiFetch<{ sections: SectionDraft[] }>(`/api/meetings/${meetingId}/sections`),
    enabled: meetingId != null,
  });
}

export function useUpdateSection(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      key: string;
      title?: string;
      content_md?: string;
      status?: "pending" | "draft" | "approved";
      mode?: "template" | "ai";
      required_sources?: string[];
    }) =>
      apiFetch<{ section: SectionDraft }>(`/api/meetings/${meetingId}/sections/${vars.key}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: vars.title,
          content_md: vars.content_md,
          status: vars.status,
          mode: vars.mode,
          required_sources: vars.required_sources,
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", meetingId, "sections"] }),
  });
}

export function useCreateSection(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      title: string;
      mode?: "template" | "ai";
      content_md?: string;
      template_body_text?: string;
      required_sources?: string[];
    }) =>
      apiFetch<{ section: SectionDraft }>(`/api/meetings/${meetingId}/sections`, {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", meetingId, "sections"] }),
  });
}

export type SectionTemplate = {
  key: string;
  title: string;
  body_text: string;
  placeholders: { token: string; raw: string }[];
  required_sources: string[];
  template_id: number;
  template_slug: string;
  template_title: string;
};

export function useSectionTemplates() {
  return useQuery({
    queryKey: ["section-templates"],
    queryFn: () => apiFetch<{ sections: SectionTemplate[] }>(`/api/section-templates`),
  });
}

export function useDeleteSection(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      apiFetch<{ ok: true }>(`/api/meetings/${meetingId}/sections/${key}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", meetingId, "sections"] }),
  });
}

export function useReorderSections(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sectionKeys: string[]) =>
      apiFetch<{ sections: SectionDraft[] }>(`/api/meetings/${meetingId}/sections/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ section_keys: sectionKeys }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", meetingId, "sections"] }),
  });
}

export function useRevertSection(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      apiFetch<{ section: SectionDraft }>(`/api/meetings/${meetingId}/sections/${key}/revert`, {
        method: "POST",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", meetingId, "sections"] }),
  });
}

export function useGenerateSection(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      key: string;
      provider?: ProviderInfo["id"];
      model?: string;
      user_prompt?: string;
      source_ids?: number[];
    }) =>
      apiFetch<{ section: SectionDraft }>(`/api/meetings/${meetingId}/sections/${vars.key}/generate`, {
        method: "POST",
        body: JSON.stringify({
          provider: vars.provider,
          model: vars.model,
          user_prompt: vars.user_prompt,
          source_ids: vars.source_ids,
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", meetingId, "sections"] }),
  });
}

export async function downloadExport(meetingId: number, fmt: "docx" | "pdf"): Promise<void> {
  const blob = await apiBlob(`/api/meetings/${meetingId}/export/${fmt}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `minutes-${meetingId}.${fmt}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function usePreview(meetingId: number | null) {
  return useQuery({
    queryKey: ["meetings", meetingId, "preview"],
    queryFn: () =>
      apiFetch<{
        label: string;
        variables: Record<string, string>;
        sections: Array<{ section_key: string; ordinal: number; title: string; content_md: string; status: string }>;
      }>(`/api/meetings/${meetingId}/preview`),
    enabled: meetingId != null,
  });
}
