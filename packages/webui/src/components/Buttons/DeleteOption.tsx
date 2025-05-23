import { Button } from '@/components/ui/button';
import { FC } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrash } from '@fortawesome/free-solid-svg-icons';
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
      <FontAwesomeIcon icon={faTrash} />
    </Button>
  );
};

export default DeleteOption;
