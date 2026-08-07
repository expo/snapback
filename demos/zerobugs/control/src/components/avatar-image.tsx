import {memo, type ImgHTMLAttributes} from 'react';
import {avatarURLWithSize} from '../avatar-url-with-size.ts';
import type {User} from '../data/types.ts';

interface AvatarImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  user: User;
}

export const AvatarImage = memo((props: AvatarImageProps) => {
  const {user, ...rest} = props;
  return (
    <img
      src={avatarURLWithSize(user.avatar)}
      alt={user.name ?? undefined}
      {...rest}
    />
  );
});
