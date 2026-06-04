'use client'

import { useState } from 'react'
import { ScrollText, Calendar, Filter } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { PageTransition, StaggerItem, motion, staggerContainer, staggerItem } from '@/lib/motion'

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

interface AuditEvent {
  id: string
  timestamp: string
  user: string
  action: string
  details: string
  ip: string
}

const auditEvents: AuditEvent[] = [
  {
    id: 'log-1',
    timestamp: '2026-04-02 14:32:15',
    user: 'Dr. Ananya Sharma',
    action: 'Completed Case',
    details: 'Case #CS-001 "Diabetic Retinopathy Progression" completed with score 85%',
    ip: '192.168.1.42',
  },
  {
    id: 'log-2',
    timestamp: '2026-04-02 13:18:04',
    user: 'Dr. Vikram Reddy',
    action: 'Submitted DOPS',
    details: 'DOPS assessment submitted for Slit Lamp examination',
    ip: '192.168.1.55',
  },
  {
    id: 'log-3',
    timestamp: '2026-04-02 11:45:22',
    user: 'Dr. Rohan Mehta',
    action: 'Updated Profile',
    details: 'Updated specialization and department information',
    ip: '192.168.1.38',
  },
  {
    id: 'log-4',
    timestamp: '2026-04-02 10:12:08',
    user: 'Dr. Sneha Kulkarni',
    action: 'Completed Case',
    details: 'Case #CS-003 "Acute Angle Closure" completed with score 92%',
    ip: '192.168.1.61',
  },
  {
    id: 'log-5',
    timestamp: '2026-04-01 16:55:33',
    user: 'Rajesh Kumar',
    action: 'Added User',
    details: 'New resident Dr. Pranav Iyer added to Glaucoma department',
    ip: '192.168.1.10',
  },
  {
    id: 'log-6',
    timestamp: '2026-04-01 15:20:41',
    user: 'Dr. Kavya Desai',
    action: 'Submitted DOPS',
    details: 'DOPS assessment submitted for Fundoscopy evaluation',
    ip: '192.168.1.72',
  },
  {
    id: 'log-7',
    timestamp: '2026-04-01 14:08:19',
    user: 'Dr. Prashant Garg',
    action: 'Created Session',
    details: 'Scheduled classroom session "Microbial Keratitis" for April 7',
    ip: '192.168.1.25',
  },
  {
    id: 'log-8',
    timestamp: '2026-04-01 11:30:56',
    user: 'Dr. Deepika Nair',
    action: 'Completed Case',
    details: 'Case #CS-005 "Optic Neuritis Workup" completed with score 78%',
    ip: '192.168.1.44',
  },
  {
    id: 'log-9',
    timestamp: '2026-03-31 17:42:10',
    user: 'Rajesh Kumar',
    action: 'Updated Settings',
    details: 'Modified notification preferences and AI model settings',
    ip: '192.168.1.10',
  },
  {
    id: 'log-10',
    timestamp: '2026-03-31 09:15:28',
    user: 'Dr. Gullapalli N. Rao',
    action: 'Reviewed Portfolio',
    details: 'Reviewed and approved portfolio for Dr. Kavya Desai (PGY-3)',
    ip: '192.168.1.15',
  },
]

const actionTypes = [
  'All Actions',
  'Completed Case',
  'Submitted DOPS',
  'Updated Profile',
  'Added User',
  'Created Session',
  'Updated Settings',
  'Reviewed Portfolio',
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AuditLogsPage() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [userFilter, setUserFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('All Actions')

  const filteredEvents = auditEvents.filter((event) => {
    if (userFilter) {
      const q = userFilter.toLowerCase()
      if (!event.user.toLowerCase().includes(q)) return false
    }
    if (actionFilter !== 'All Actions' && event.action !== actionFilter) return false
    if (dateFrom && event.timestamp < dateFrom) return false
    if (dateTo && event.timestamp > dateTo + ' 23:59:59') return false
    return true
  })

  return (
    <PageTransition className="space-y-6">
      {/* Page header */}
      <StaggerItem>
        <div>
          <div className="flex items-center gap-2">
            <ScrollText className="size-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Audit Logs</h1>
          </div>
        </div>
      </StaggerItem>

      {/* Filter row */}
      <StaggerItem>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Calendar className="size-4 text-muted-foreground" />
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-[150px]"
              placeholder="From"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-[150px]"
            />
          </div>
          <div className="relative">
            <Filter className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filter by user..."
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="pl-8 w-[200px]"
            />
          </div>
          <Select value={actionFilter} onValueChange={(v) => setActionFilter(v ?? '')}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Action type" />
            </SelectTrigger>
            <SelectContent>
              {actionTypes.map((action) => (
                <SelectItem key={action} value={action}>
                  {action}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </StaggerItem>

      {/* Table */}
      <StaggerItem>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Timestamp</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">User</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Action</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Details</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">IP Address</th>
              </tr>
            </thead>
            <motion.tbody
              initial="hidden"
              animate="visible"
              variants={staggerContainer}
            >
              {filteredEvents.map((event, index) => (
                <motion.tr
                  key={event.id}
                  variants={staggerItem}
                  className={`border-b last:border-0 ${index % 2 === 1 ? 'bg-muted/20' : ''}`}
                >
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground font-mono text-xs">
                    {event.timestamp}
                  </td>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">{event.user}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                      {event.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-sm truncate">
                    {event.details}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs whitespace-nowrap">
                    {event.ip}
                  </td>
                </motion.tr>
              ))}
            </motion.tbody>
          </table>
        </div>
      </StaggerItem>

      <StaggerItem>
        <p className="text-xs text-muted-foreground">
          Showing {filteredEvents.length} events
        </p>
      </StaggerItem>
    </PageTransition>
  )
}
