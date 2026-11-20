import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export function StatusItem(props: { icon: IconName; label: string; detail: ReactNode; badge?: ReactNode }) {
  return (
    <div className="status-item">
      <div className="status-icon">
        <Icon name={props.icon} />
      </div>
      <div className="status-body">
        <div className="status-label">{props.label}</div>
        <div className="status-detail">{props.detail}</div>
      </div>
      {props.badge}
    </div>
  )
}
