export interface Me { userId: string; email: string; fullName: string; roles: string[]; permissions: string[]; allProjects: boolean; mustChangePassword?: boolean }
export interface ProjectRef { id: string; code: string; name: string; status: string }
export interface SiteRef { id: string; projectId: string; code: string; name: string }
export interface LocationRef { id: string; code: string; name: string; type: "warehouse" | "site_store" | "transit"; projectId: string | null; projectCode: string | null }
export interface CostCodeRef { id: string; code: string; name: string; category: string }
export interface UnitRef { code: string; name: string; dimension: string }
export interface Reference {
  projects: ProjectRef[]; sites: SiteRef[]; locations: LocationRef[]; costCodes: CostCodeRef[]; units: UnitRef[];
  vatCodes: { code: string; label: string; rate: string }[]; vatVerified: boolean;
  partners: { id: string; name: string; isSubcontractor: boolean; isConsultant: boolean }[];
}
export interface Item { id: string; code: string; description: string; category: string; baseUnit: string; purchaseUnit: string | null; conversions: { unitCode: string; baseUnitsPerUnit: string }[] }
export interface Fulfilment { requested: string; issued: string; reserved: string; onOrder: string; inTransit: string; uncovered: string }
export interface ApprovalStep { id: string; stepNo: number; roleKey: string; status: string; decidedBy: string | null; deciderName: string | null; decidedAt: string | null; comment: string | null; docRevision: number }
export interface ApprovalRequest { id: string; docRevision: number; status: string; requestedAt: string; amount: string | null; steps: ApprovalStep[] }
export interface PendingApproval { requestId: string; docType: "material_request" | "purchase_order"; docId: string; docNumber: string; projectCode: string; amount: string | null; requesterName: string; stepNo: number; roleKey: string; requestedAt: string }
