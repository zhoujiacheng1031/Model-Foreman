import type { ForemanBridge } from '../../shared/contracts'

declare global { interface Window { foreman: ForemanBridge } }
export {}
