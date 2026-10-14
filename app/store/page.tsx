import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Store | Parkes Rummy',
  description: 'One-off optional Parkes Rummy extras.',
};

/** Keep the same header, account area and Play / Your Games / Store tabs. */
export default function StorePage() {
  redirect('/?tab=store');
}
