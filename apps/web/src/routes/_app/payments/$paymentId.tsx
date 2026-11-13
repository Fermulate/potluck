import { createFileRoute } from '@tanstack/react-router'
import { PaymentDetail } from '@/features/settle/payment-detail'

export const Route = createFileRoute('/_app/payments/$paymentId')({
  component: PaymentRoute,
})

function PaymentRoute() {
  const { paymentId } = Route.useParams()
  return <PaymentDetail key={paymentId} paymentId={paymentId} />
}
