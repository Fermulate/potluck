import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { EditPayment } from '@/features/settle/edit-payment'

export const Route = createFileRoute('/_app/payments/$paymentId_/edit')({
  component: EditPaymentRoute,
})

function EditPaymentRoute() {
  const { paymentId } = Route.useParams()
  const navigate = useNavigate()
  const back = () => void navigate({ to: '/payments/$paymentId', params: { paymentId } })
  return <EditPayment key={paymentId} paymentId={paymentId} onClose={back} onDone={back} />
}
