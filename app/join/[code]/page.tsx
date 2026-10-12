import ParkesApp from '../../components/ParkesApp';
import { normalizeRoomCode } from '../../../lib/room-code';

export default async function JoinRoom({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <ParkesApp initialCode={normalizeRoomCode(code)} />;
}
