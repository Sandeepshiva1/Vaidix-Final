'use client'

import { useState } from 'react'
import {
  Settings,
  Globe,
  Bell,
  Brain,
  Shield,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { PageTransition, StaggerItem, motion } from '@/lib/motion'

// ---------------------------------------------------------------------------
// Toggle switch (inline since no Switch component exists)
// ---------------------------------------------------------------------------

function Toggle({
  enabled,
  onToggle,
  label,
}: {
  enabled: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={onToggle}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${
          enabled ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          className={`pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform ${
            enabled ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SystemSettingsPage() {
  // General
  const [platformName, setPlatformName] = useState('Vaidix')
  const [timezone, setTimezone] = useState('Asia/Kolkata')
  const [language, setLanguage] = useState('en')

  // Notifications
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [pushNotifications, setPushNotifications] = useState(true)

  // AI — tier values are intentionally provider-neutral. The actual model
  // routing per tier lives in env config and the AI router (see
  // server/services/ai/router.ts). Surfacing concrete model identity here
  // would tell anyone with admin access which vendor we run on.
  const [aiModel, setAiModel] = useState('reasoning-balanced')
  const [ragEnabled, setRagEnabled] = useState(true)
  const [temperature] = useState(0.7)

  // Data & Privacy
  const [dataRetention, setDataRetention] = useState('365')
  const [anonymization, setAnonymization] = useState(false)

  return (
    <PageTransition className="space-y-6">
      {/* Page header */}
      <StaggerItem>
        <div>
          <div className="flex items-center gap-2">
            <Settings className="size-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">System Settings</h1>
          </div>
        </div>
      </StaggerItem>

      <StaggerItem>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* General Settings */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Globe className="size-4 text-muted-foreground" />
                  <CardTitle>General Settings</CardTitle>
                </div>
                <CardDescription>Platform name, timezone, and language preferences</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Platform Name</label>
                  <Input value={platformName} onChange={(e) => setPlatformName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Timezone</label>
                  <Select value={timezone} onValueChange={(v) => setTimezone(v ?? '')}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Asia/Kolkata">Asia/Kolkata (IST)</SelectItem>
                      <SelectItem value="UTC">UTC</SelectItem>
                      <SelectItem value="America/New_York">America/New York (EST)</SelectItem>
                      <SelectItem value="Europe/London">Europe/London (GMT)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Language</label>
                  <Select value={language} onValueChange={(v) => setLanguage(v ?? '')}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="hi">Hindi</SelectItem>
                      <SelectItem value="te">Telugu</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Notification Settings */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Bell className="size-4 text-muted-foreground" />
                  <CardTitle>Notification Settings</CardTitle>
                </div>
                <CardDescription>Manage how users receive notifications</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Toggle
                  label="Email Notifications"
                  enabled={emailNotifications}
                  onToggle={() => setEmailNotifications(!emailNotifications)}
                />
                <Separator />
                <Toggle
                  label="Push Notifications"
                  enabled={pushNotifications}
                  onToggle={() => setPushNotifications(!pushNotifications)}
                />
              </CardContent>
            </Card>
          </motion.div>

          {/* AI Settings */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Brain className="size-4 text-muted-foreground" />
                  <CardTitle>AI Settings</CardTitle>
                </div>
                <CardDescription>Configure AI model and RAG pipeline</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Reasoning tier</label>
                  <Select value={aiModel} onValueChange={(v) => setAiModel(v ?? '')}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reasoning-high">Reasoning (high)</SelectItem>
                      <SelectItem value="reasoning-balanced">Reasoning (balanced)</SelectItem>
                      <SelectItem value="fast">Fast</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Pick the depth-vs-latency profile. Concrete model routing is configured server-side.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Temperature</label>
                  <div className="flex items-center gap-3">
                    <div className="relative flex-1 h-2 rounded-full bg-muted">
                      <div
                        className="absolute left-0 top-0 h-2 rounded-full bg-primary"
                        style={{ width: `${temperature * 100}%` }}
                      />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 size-4 rounded-full bg-primary border-2 border-background shadow"
                        style={{ left: `calc(${temperature * 100}% - 8px)` }}
                      />
                    </div>
                    <span className="text-sm font-mono w-8 text-right">{temperature}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Lower values produce more focused responses</p>
                </div>
                <Separator />
                <Toggle
                  label="RAG (Retrieval-Augmented Generation)"
                  enabled={ragEnabled}
                  onToggle={() => setRagEnabled(!ragEnabled)}
                />
              </CardContent>
            </Card>
          </motion.div>

          {/* Data & Privacy */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Shield className="size-4 text-muted-foreground" />
                  <CardTitle>Data & Privacy</CardTitle>
                </div>
                <CardDescription>Data retention and anonymization policies</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Data Retention Period</label>
                  <Select value={dataRetention} onValueChange={(v) => setDataRetention(v ?? '')}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="90">90 days</SelectItem>
                      <SelectItem value="180">180 days</SelectItem>
                      <SelectItem value="365">1 year</SelectItem>
                      <SelectItem value="730">2 years</SelectItem>
                      <SelectItem value="unlimited">Unlimited</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <Toggle
                  label="Anonymize Exported Data"
                  enabled={anonymization}
                  onToggle={() => setAnonymization(!anonymization)}
                />
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </StaggerItem>

      <StaggerItem>
        <div className="flex justify-end">
          <Button>Save All Settings</Button>
        </div>
      </StaggerItem>
    </PageTransition>
  )
}
