import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearPersistedAuth,
  getAccessTokenFromStorage,
  getRefreshTokenFromStorage,
  isAuthInactive,
  persistTokens,
} from "./auth.tsx";

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
  placeholders: Array<{ token: string; raw: string; kind?: "text" | "date" }>;
};

export type Placeholder = { token: string; raw: string; kind?: "text" | "date"; required?: boolean; editable?: boolean; custom?: boolean; section_keys?: string[] };

export type ParsedTemplate = {
  title: string;
  preambleText: string;
  globalPlaceholders: Placeholder[];
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
  user_id: number;
  owner_email?: string | null;
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
  section_key?: string | null;
  created_at: string;
};

export type AppUser = {
  id: number;
  email: string;
  role: "user" | "admin" | "super_admin";
  two_factor_enabled: boolean;
  created_at: string;
  updated_at: string | null;
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
  required_variables: string[];
  last_ai_provider: string | null;
  last_ai_model: string | null;
  updated_at: string;
};

export type SectionPrompt = {
  system: string;
  prompt: string;
  generated_prompt?: string;
  saved_prompt?: string | null;
};

export type VariableValuesResponse = {
  values: Record<string, string[]>;
  genders?: Record<string, Record<string, string>>;
};

// ---- Fetch wrapper ----

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithAuth(path, init);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 401) {
      clearPersistedAuth();
      if (window.location.pathname !== "/login") window.location.assign("/login");
    }
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function apiBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const res = await fetchWithAuth(path, init);
  if (!res.ok) {
    if (res.status === 401) {
      clearPersistedAuth();
      if (window.location.pathname !== "/login") window.location.assign("/login");
    }
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return await res.blob();
}

async function fetchWithAuth(path: string, init: RequestInit = {}, didRefresh = false): Promise<Response> {
  if (isAuthInactive()) {
    clearPersistedAuth();
    if (window.location.pathname !== "/login") window.location.assign("/login");
    return new Response(JSON.stringify({ error: "inactive session" }), { status: 401 });
  }
  const token = getAccessTokenFromStorage();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!(init.body instanceof FormData) && init.body) {
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  if (res.status !== 401 || didRefresh) return res;
  const refreshed = await refreshAccessToken();
  if (!refreshed) return res;
  return fetchWithAuth(path, init, true);
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshTokenFromStorage();
  if (!refreshToken || isAuthInactive()) return false;
  const res = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) return false;
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string };
  if (!data.access_token) return false;
  persistTokens(data.access_token, data.refresh_token);
  return true;
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

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<{ users: AppUser[] }>("/api/users"),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { email: string; role?: "user" | "admin" }) =>
      apiFetch<{ user: AppUser }>("/api/users", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
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

export function useDeleteMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ ok: true }>(`/api/meetings/${id}`, { method: "DELETE" }),
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
    mutationFn: async (vars: { files?: FileList | File[]; text?: string; label?: string; sectionKey?: string }) => {
      const fd = new FormData();
      if (vars.label) fd.set("label", vars.label);
      if (vars.sectionKey) fd.set("section_key", vars.sectionKey);
      if (vars.text) fd.set("text", vars.text);
      const files = vars.files ? Array.from(vars.files) : [];
      for (const f of files) fd.append("files", f);
      return apiFetch<{ sources: Source[] }>(`/api/meetings/${meetingId}/sources`, {
        method: "POST",
        body: fd,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", meetingId, "sources"], exact: false }),
  });
}

export function useDeleteSource(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: number) =>
      apiFetch<{ ok: true }>(`/api/meetings/${meetingId}/sources/${sourceId}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", meetingId, "sources"], exact: false }),
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
      required_variables?: string[];
      new_variables?: Array<{ raw: string; kind?: "text" | "date" }>;
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
  required_variables: string[];
  template_id: number;
  template_slug: string;
  template_title: string;
  custom_id?: number;
  owner_user_id?: number;
  owner_email?: string | null;
  can_edit?: boolean;
};

export function useSectionTemplates() {
  return useQuery({
    queryKey: ["section-templates"],
    queryFn: () => apiFetch<{ sections: SectionTemplate[] }>(`/api/section-templates`),
  });
}

export function useCreateSectionTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      title: string;
      body_text: string;
      required_sources?: string[];
      required_variables?: string[];
      new_variables?: Array<{ raw: string; kind?: "text" | "date" }>;
    }) =>
      apiFetch<{ template: SectionTemplate }>(`/api/section-templates`, {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["section-templates"] }),
  });
}

export function useUpdateSectionTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      customId: number;
      title?: string;
      body_text?: string;
      required_sources?: string[];
      required_variables?: string[];
      new_variables?: Array<{ raw: string; kind?: "text" | "date" }>;
    }) =>
      apiFetch<{ template: SectionTemplate }>(`/api/section-templates/custom/${vars.customId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: vars.title,
          body_text: vars.body_text,
          required_sources: vars.required_sources,
          required_variables: vars.required_variables,
          new_variables: vars.new_variables,
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["section-templates"] }),
  });
}

export function useUpdateBaseSectionTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      sectionKey: string;
      title?: string;
      body_text?: string;
      required_sources?: string[];
      required_variables?: string[];
      new_variables?: Array<{ raw: string; kind?: "text" | "date" }>;
    }) =>
      apiFetch<{ template: SectionTemplate | null; variables: Placeholder[] }>(`/api/section-templates/${vars.sectionKey}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: vars.title,
          body_text: vars.body_text,
          required_sources: vars.required_sources,
          required_variables: vars.required_variables,
          new_variables: vars.new_variables,
        }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["section-templates"] });
      qc.setQueryData(["template-variables"], { variables: data.variables });
      qc.invalidateQueries({ queryKey: ["meetings"] });
    },
  });
}



export function useUpdateSectionTemplateVariables() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      sectionKey: string;
      required_variables: string[];
      new_variables?: Array<{ raw: string; kind?: "text" | "date" }>;
    }) =>
      apiFetch<{ section: SectionTemplate | null; variables: Placeholder[] }>(
        `/api/section-templates/${vars.sectionKey}/variables`,
        {
          method: "PATCH",
          body: JSON.stringify({
            required_variables: vars.required_variables,
            new_variables: vars.new_variables,
          }),
        },
      ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["section-templates"] });
      qc.setQueryData(["template-variables"], { variables: data.variables });
      qc.invalidateQueries({ queryKey: ["meetings"] });
    },
  });
}

export function useTemplateVariables() {
  return useQuery({
    queryKey: ["template-variables"],
    queryFn: () => apiFetch<{ variables: Placeholder[] }>(`/api/template-variables`),
    staleTime: 5 * 60_000,
  });
}

export function useCreateTemplateVariable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { raw: string; kind?: "text" | "date"; section_keys: string[] }) =>
      apiFetch<{ variables: Placeholder[] }>(`/api/template-variables`, {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: (data) => {
      qc.setQueryData(["template-variables"], data);
      qc.invalidateQueries({ queryKey: ["section-templates"] });
      qc.invalidateQueries({ queryKey: ["template-variables"] });
    },
  });
}

export function useUpdateTemplateVariable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { token: string; raw: string; kind?: "text" | "date"; section_keys: string[] }) =>
      apiFetch<{ variables: Placeholder[] }>(`/api/template-variables/${vars.token}`, {
        method: "PATCH",
        body: JSON.stringify({ raw: vars.raw, kind: vars.kind, section_keys: vars.section_keys }),
      }),
    onSuccess: (data) => {
      qc.setQueryData(["template-variables"], data);
      qc.invalidateQueries({ queryKey: ["section-templates"] });
      qc.invalidateQueries({ queryKey: ["meetings"] });
    },
  });
}



export function useDeleteTemplateVariable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      apiFetch<{ variables: Placeholder[] }>(`/api/template-variables/${token}`, { method: "DELETE" }),
    onSuccess: (data) => {
      qc.setQueryData(["template-variables"], data);
      qc.invalidateQueries({ queryKey: ["section-templates"] });
      qc.invalidateQueries({ queryKey: ["variable-values"] });
      qc.invalidateQueries({ queryKey: ["meetings"] });
    },
  });
}

export function useDeleteSectionTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (customId: number) =>
      apiFetch<{ ok: true }>(`/api/section-templates/custom/${customId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["section-templates"] }),
  });
}

export function useVariableValues() {
  return useQuery({
    queryKey: ["variable-values"],
    queryFn: () => apiFetch<VariableValuesResponse>(`/api/variable-values`),
    staleTime: 60_000,
  });
}

export function useSaveVariableValues() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entries: Array<{ token: string; value: string; gender?: string }>) =>
      apiFetch<VariableValuesResponse>(`/api/variable-values`, {
        method: "POST",
        body: JSON.stringify({ entries }),
      }),
    onSuccess: (data) => qc.setQueryData(["variable-values"], data),
  });
}

export function useUpdateVariableValue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { token: string; old_value: string; value: string; gender?: string }) =>
      apiFetch<VariableValuesResponse>(`/api/variable-values`, {
        method: "PATCH",
        body: JSON.stringify(vars),
      }),
    onSuccess: (data) => qc.setQueryData(["variable-values"], data),
  });
}

export function useDeleteVariableValue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { token: string; value: string }) =>
      apiFetch<VariableValuesResponse>(`/api/variable-values`, {
        method: "DELETE",
        body: JSON.stringify(vars),
      }),
    onSuccess: (data) => qc.setQueryData(["variable-values"], data),
  });
}

export type ExampleSource = { label: string; file: string; download_url: string };

export function useSectionExamples(sectionKey: string | null) {
  return useQuery({
    queryKey: ["section-examples", sectionKey],
    queryFn: () => apiFetch<{ examples: ExampleSource[] }>(`/api/sections/${sectionKey}/examples`),
    enabled: !!sectionKey,
    staleTime: 5 * 60_000,
  });
}

export async function downloadExampleSource(url: string, filename: string): Promise<void> {
  const blob = await apiBlob(url);
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
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
      prompt_override?: string;
      source_ids?: number[];
    }) =>
      apiFetch<{ section: SectionDraft }>(`/api/meetings/${meetingId}/sections/${vars.key}/generate`, {
        method: "POST",
        body: JSON.stringify({
          provider: vars.provider,
          model: vars.model,
          user_prompt: vars.user_prompt,
          prompt_override: vars.prompt_override,
          source_ids: vars.source_ids,
        }),
      }),
    onSuccess: (data, vars) => {
      qc.setQueryData<{ sections: SectionDraft[] }>(["meetings", meetingId, "sections"], (old) => {
        if (!old?.sections || !data.section) return old;
        return {
          sections: old.sections.map((s) => (s.section_key === vars.key ? data.section : s)),
        };
      });
      qc.invalidateQueries({ queryKey: ["meetings", meetingId, "sections"] });
    },
  });
}

export function useSectionPrompt(meetingId: number, sectionKey: string | null) {
  return useQuery({
    queryKey: ["meetings", meetingId, "sections", sectionKey, "prompt"],
    queryFn: () =>
      apiFetch<SectionPrompt>(
        `/api/meetings/${meetingId}/sections/${sectionKey}/prompt`,
      ),
    enabled: meetingId != null && !!sectionKey,
    staleTime: 0,
  });
}

export function useSaveSectionPrompt(meetingId: number, sectionKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prompt: string) =>
      apiFetch<SectionPrompt>(`/api/meetings/${meetingId}/sections/${sectionKey}/prompt`, {
        method: "PATCH",
        body: JSON.stringify({ prompt }),
      }),
    onSuccess: (data) => {
      qc.setQueryData(["meetings", meetingId, "sections", sectionKey, "prompt"], data);
    },
  });
}

export function useResetSectionPrompt(meetingId: number, sectionKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<SectionPrompt>(`/api/meetings/${meetingId}/sections/${sectionKey}/prompt`, {
        method: "DELETE",
      }),
    onSuccess: (data) => {
      qc.setQueryData(["meetings", meetingId, "sections", sectionKey, "prompt"], data);
    },
  });
}

export async function downloadExport(meetingId: number, fmt: "docx" | "pdf"): Promise<void> {
  const blob = await apiBlob(`/api/meetings/${meetingId}/export/${fmt}`);
  saveBlob(blob, `minutes-${meetingId}.${fmt}`);
}

export async function downloadCombinedMeetingsExport(meetingIds: number[]): Promise<void> {
  const blob = await apiBlob("/api/meetings/export/docx", {
    method: "POST",
    body: JSON.stringify({ meeting_ids: meetingIds }),
  });
  saveBlob(blob, "combined-minutes.docx");
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
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
