'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Brain,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ensureCsrfHeaders } from '@/lib/csrf-client';
import { PageTransition, StaggerItem } from '@/lib/motion';

// Match the server-side StyleProfileSummary shape — kept inline so the client
// file doesn't need a dependency on the server module.
interface StyleRule {
  id: string;
  rule: string;
  scopeTags: string[];
  sourceSignalIds: string[];
  createdAt: string;
}
interface StyleProfileSummary {
  status: 'EMPTY' | 'ACTIVE' | 'USER_DISABLED';
  version: number;
  rules: StyleRule[];
  lastBuildAt: string | null;
  signalCountAtBuild: number;
  totalSignals: number;
  unprocessedSignals: number;
}

interface Props {
  initialProfile: StyleProfileSummary;
  memoryOptIn: boolean;
}

const MIN_SIGNALS = 5;

export function StyleProfileClient({ initialProfile, memoryOptIn }: Props) {
  const router = useRouter();
  const [profile, setProfile] = useState<StyleProfileSummary>(initialProfile);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<'rebuild' | 'save' | 'clear' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRebuild = useMemo(
    () => memoryOptIn && profile.totalSignals >= MIN_SIGNALS && pending !== 'rebuild',
    [memoryOptIn, profile.totalSignals, pending],
  );

  async function handleRebuild() {
    setPending('rebuild');
    setError(null);
    try {
      const headers = { 'Content-Type': 'application/json', ...(await ensureCsrfHeaders()) };
      const res = await fetch('/api/me/style-profile/rebuild', { method: 'POST', headers });
      const json = (await res.json()) as { ok: boolean; data?: { profile: StyleProfileSummary }; error?: { message?: string } };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? 'Rebuild failed');
      }
      setProfile(json.data.profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rebuild failed');
    } finally {
      setPending(null);
    }
  }

  async function handleSave() {
    setPending('save');
    setError(null);
    try {
      const headers = { 'Content-Type': 'application/json', ...(await ensureCsrfHeaders()) };
      const merged = profile.rules.map((r) => ({
        id: r.id,
        rule: editing[r.id] ?? r.rule,
        scopeTags: r.scopeTags,
      }));
      const res = await fetch('/api/me/style-profile', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ rules: merged }),
      });
      const json = (await res.json()) as { ok: boolean; data?: { profile: StyleProfileSummary }; error?: { message?: string } };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? 'Save failed');
      }
      setProfile(json.data.profile);
      setEditing({});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setPending(null);
    }
  }

  async function handleDeleteRule(ruleId: string) {
    setPending('save');
    setError(null);
    try {
      const headers = { 'Content-Type': 'application/json', ...(await ensureCsrfHeaders()) };
      const remaining = profile.rules
        .filter((r) => r.id !== ruleId)
        .map((r) => ({ id: r.id, rule: editing[r.id] ?? r.rule, scopeTags: r.scopeTags }));
      const res = await fetch('/api/me/style-profile', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ rules: remaining }),
      });
      const json = (await res.json()) as { ok: boolean; data?: { profile: StyleProfileSummary }; error?: { message?: string } };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? 'Delete failed');
      }
      setProfile(json.data.profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setPending(null);
    }
  }

  async function handleClearAll() {
    if (!confirm('Clear all style rules AND erase the edit-signal history? This is irreversible.')) return;
    setPending('clear');
    setError(null);
    try {
      const headers = { 'Content-Type': 'application/json', ...(await ensureCsrfHeaders()) };
      const res = await fetch('/api/me/style-profile', { method: 'DELETE', headers });
      const json = (await res.json()) as { ok: boolean; error?: { message?: string } };
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message ?? 'Clear failed');
      }
      setProfile({
        status: 'EMPTY',
        version: 0,
        rules: [],
        lastBuildAt: null,
        signalCountAtBuild: 0,
        totalSignals: 0,
        unprocessedSignals: 0,
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Clear failed');
    } finally {
      setPending(null);
    }
  }

  const hasUnsavedEdits = Object.keys(editing).some((id) => {
    const r = profile.rules.find((x) => x.id === id);
    return r && editing[id] !== r.rule;
  });

  return (
    <PageTransition className="space-y-6" data-testid="style-profile-page">
      <StaggerItem>
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/profile"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Back to profile
          </Link>
          <Badge variant="outline" className="gap-1">
            <Sparkles className="size-3" /> v{profile.version}
          </Badge>
        </div>
      </StaggerItem>

      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Brain className="size-5 text-primary" /> AI style memory
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              When you forge a new deck, the AI reads these rules — distilled from your past edits — to
              match your teaching style. Style memory is yours alone; no other teacher&apos;s
              preferences ever influence your decks.
            </p>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <Stat label="Total signals" value={profile.totalSignals} />
              <Stat label="Since last build" value={profile.unprocessedSignals} />
              <Stat
                label="Last built"
                value={profile.lastBuildAt ? new Date(profile.lastBuildAt).toLocaleDateString('en-IN') : '—'}
              />
            </div>
          </CardContent>
        </Card>
      </StaggerItem>

      {!memoryOptIn && (
        <StaggerItem>
          <Card className="border-amber-300/50 bg-amber-50/40 dark:bg-amber-950/20">
            <CardContent className="flex gap-3 pt-6 text-sm">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />
              <div className="space-y-1">
                <p className="font-medium">AI memory is currently off in your preferences.</p>
                <p className="text-muted-foreground">
                  No edits are being captured and no rules are injected into the AI prompt.
                  Re-enable it from your Preferences to start learning your style.
                </p>
              </div>
            </CardContent>
          </Card>
        </StaggerItem>
      )}

      <AnimatePresence>
        {error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-xl border border-rose-300/60 bg-rose-50/60 px-4 py-2 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300"
            data-testid="style-profile-error"
          >
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 text-xs underline opacity-70 hover:opacity-100"
            >
              dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>Active rules</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRebuild}
                  disabled={!canRebuild}
                  data-testid="rebuild-btn"
                >
                  {pending === 'rebuild' ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 size-3.5" />
                  )}
                  Rebuild from edits
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {profile.rules.length === 0 ? (
              <EmptyState totalSignals={profile.totalSignals} memoryOptIn={memoryOptIn} />
            ) : (
              <ul className="space-y-2" data-testid="rules-list">
                <AnimatePresence initial={false}>
                  {profile.rules.map((rule) => (
                    <motion.li
                      key={rule.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -16 }}
                      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                      className="group flex items-start gap-3 rounded-xl border border-border bg-card/40 p-3 transition-colors hover:border-border/80"
                      data-testid="rule-row"
                    >
                      <Sparkles className="mt-1 size-4 shrink-0 text-primary/70" />
                      <div className="flex-1 space-y-1.5">
                        <Input
                          value={editing[rule.id] ?? rule.rule}
                          onChange={(e) =>
                            setEditing((prev) => ({ ...prev, [rule.id]: e.target.value }))
                          }
                          className="h-8 border-transparent bg-transparent px-2 text-sm shadow-none focus-visible:border-border focus-visible:bg-background"
                          maxLength={200}
                          data-testid={`rule-input-${rule.id}`}
                        />
                        <div className="flex flex-wrap gap-1.5">
                          {rule.scopeTags.length === 0 ? (
                            <Badge variant="secondary" className="text-[10px]">
                              always-on
                            </Badge>
                          ) : (
                            rule.scopeTags.map((t) => (
                              <Badge key={t} variant="outline" className="text-[10px]">
                                {t}
                              </Badge>
                            ))
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteRule(rule.id)}
                        disabled={pending !== null}
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label="Delete rule"
                        data-testid={`delete-rule-${rule.id}`}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
            {hasUnsavedEdits && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 flex items-center justify-between rounded-lg border border-amber-300/60 bg-amber-50/40 px-3 py-2 text-xs dark:bg-amber-950/20"
              >
                <span>Unsaved changes</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing({})}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={pending === 'save'}>
                    {pending === 'save' && <Loader2 className="mr-1.5 size-3 animate-spin" />}
                    Save
                  </Button>
                </div>
              </motion.div>
            )}
          </CardContent>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card>
          <CardContent className="flex flex-col items-start gap-2 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold">Forget everything</h3>
              <p className="text-xs text-muted-foreground">
                Clears all rules AND deletes the underlying edit signals. Irreversible.
              </p>
            </div>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleClearAll}
              disabled={pending !== null || profile.totalSignals === 0}
              data-testid="clear-all-btn"
            >
              {pending === 'clear' ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 size-3.5" />
              )}
              Clear AI memory
            </Button>
          </CardContent>
        </Card>
      </StaggerItem>
    </PageTransition>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </span>
  );
}

function EmptyState({
  totalSignals,
  memoryOptIn,
}: {
  totalSignals: number;
  memoryOptIn: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Plus className="size-5 opacity-50" />
      </div>
      {!memoryOptIn ? (
        <p>AI memory is off — enable it in preferences to start learning your style.</p>
      ) : totalSignals < MIN_SIGNALS ? (
        <p>
          Edit a few AI-generated slides ({totalSignals}/{MIN_SIGNALS}). Once we&apos;ve seen
          enough, a tiny set of style rules will appear here.
        </p>
      ) : (
        <p>
          {totalSignals} signals captured but no rules yet. Try &ldquo;Rebuild from edits&rdquo;.
        </p>
      )}
    </div>
  );
}
