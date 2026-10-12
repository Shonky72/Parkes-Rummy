/** Decorative felt detail. Motion is entirely CSS so room polling never restarts it. */
export default function BackgroundSuits() {
  return <div className="background-suits background-suits-drift" aria-hidden="true">
    <span>♠</span>
    <span>♦</span>
    <span>♣</span>
    <span>♥</span>
  </div>;
}
