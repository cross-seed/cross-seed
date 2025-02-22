import { ConfigForm } from '@/features/ConfigForm/Form';
import { ConfigValidation } from '@/features/ConfigValidation/ConfigValidation';

export function Config() {
  return (
    <div className="">
      <ConfigValidation />
      <ConfigForm />
    </div>
  );
}
