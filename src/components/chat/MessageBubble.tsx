'use client'

import type { ChatMessage, ColumnDef } from '@/lib/ai/types'
import { WorkflowPreviewCard } from './WorkflowPreviewCard'
import { CampaignPreviewCard } from '../campaigns/CampaignPreviewCard'
import { TableLinkCard } from '../table/TableLinkCard'
import { cn } from '@/lib/utils'

interface MessageBubbleProps {
  message: ChatMessage
  onApproveWorkflow?: (workflowDef: NonNullable<ChatMessage['workflowDefinition']>) => void
}

export function MessageBubble({ message, onApproveWorkflow }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isWorkflow = message.type === 'workflow_proposal'
  const isCampaign = message.type === 'campaign_proposal'
  const isTable = message.type === 'table'

  if (isCampaign && message.campaignProposal) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proposal = message.campaignProposal as any
    return (
      <div className="flex flex-col gap-3 message-enter">
        {message.content && (
          <div className="text-sm leading-relaxed text-text-secondary max-w-2xl">
            {message.content}
          </div>
        )}
        <CampaignPreviewCard
          proposal={proposal}
          conversationId="default"
        />
      </div>
    )
  }

  if (isWorkflow && message.workflowDefinition) {
    return (
      <div className="flex flex-col gap-3 message-enter">
        {message.content && (
          <div className="text-sm leading-relaxed text-text-secondary max-w-2xl">
            {message.content}
          </div>
        )}
        <WorkflowPreviewCard
          workflow={message.workflowDefinition}
          onApprove={() => onApproveWorkflow?.(message.workflowDefinition!)}
        />
      </div>
    )
  }

  if (isTable && message.resultSetId) {
    let tableData = { tableName: 'Results', rowCount: 0, columns: [] as ColumnDef[], previewRows: [] as Record<string, unknown>[] }
    try {
      const parsed = JSON.parse(message.content)
      tableData = {
        tableName: parsed.tableName ?? 'Results',
        rowCount: typeof parsed.rowCount === 'number' ? parsed.rowCount : 0,
        columns: Array.isArray(parsed.columns) ? parsed.columns : [],
        previewRows: Array.isArray(parsed.previewRows) ? parsed.previewRows : [],
      }
    } catch {
      // content isn't JSON — use defaults
    }
    return (
      <div className="message-enter">
        <div className="text-sm leading-relaxed text-text-secondary mb-2">
          Workflow complete — your leads are ready:
        </div>
        <TableLinkCard
          resultSetId={message.resultSetId}
          tableName={tableData.tableName}
          rowCount={tableData.rowCount}
          columns={tableData.columns}
          previewRows={tableData.previewRows}
        />
      </div>
    )
  }

  return (
    <div
      className={`flex message-enter ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={cn(
          "text-sm leading-relaxed max-w-2xl whitespace-pre-wrap break-words",
          isUser
            ? "bg-text-primary text-background rounded-[20px_20px_6px_20px] px-5 py-3.5"
            : "text-text-primary px-1 py-2"
        )}
      >
        {message.content}
      </div>
    </div>
  )
}
