import { Button } from '@/components/ui/button';
import { FC } from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type DeleteOptionProps = {
  className?: string;
  onClick: () => void;
};

const DeleteOption: FC<DeleteOptionProps> = ({ className, onClick }) => {
  return (
    <Button
      type="button"
      variant="destructive"
      className={cn('', className)}
      onClick={onClick}
    >
      <span className="sr-only">Delete option</span>
      <Trash2 className="size-4" />
    </Button>
  );
};

export default DeleteOption;
