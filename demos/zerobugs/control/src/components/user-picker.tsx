import {useEffect, useMemo, useState} from 'react';
import avatarIcon from '../assets/icons/avatar-default.svg';
import {avatarURLWithSize} from '../avatar-url-with-size.ts';
import {useZerobugsQuery} from '../data/queries.ts';
import type {User} from '../data/types.ts';
import {Combobox} from './combobox.tsx';

type Props = {
  projectName: string;
  onSelect?: ((user: User | undefined) => void) | undefined;
  selected?: {login?: string | undefined} | undefined;
  disabled?: boolean | undefined;
  enabledOffline?: boolean | undefined;
  unselectedLabel?: string | undefined;
  placeholder?: string | undefined;
  allowNone?: boolean | undefined;
  filter?: 'crew' | 'creators' | 'assignees' | undefined;
};

export function UserPicker({
  projectName,
  onSelect,
  selected,
  disabled,
  enabledOffline,
  unselectedLabel,
  placeholder,
  allowNone = true,
  filter = undefined,
}: Props) {
  const result = useZerobugsQuery('usersForProject', {
    projectName,
    disabled: !!disabled,
    login: selected?.login ?? null,
    filter: filter ?? null,
    limit: 200,
    start: null,
  });
  // TODO: Support case-insensitive sorting in ZQL.
  const users = useMemo(
    () => result.value?.items.toSorted((a, b) => a.login.localeCompare(b.login)) ?? [],
    [result],
  );

  // Preload the avatar icons so they show up instantly when opening the
  // dropdown.
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  useEffect(() => {
    let canceled = false;
    async function preload() {
      const avatars = await Promise.all(users.map(c => preloadAvatar(c)));
      if (canceled) {
        return;
      }
      const nextAvatars = Object.fromEntries(avatars);
      setAvatars(current => (
        Object.keys(current).length === Object.keys(nextAvatars).length
          && Object.entries(nextAvatars).every(([id, avatar]) => current[id] === avatar)
          ? current
          : nextAvatars
      ));
    }
    void preload();
    return () => {
      canceled = true;
    };
  }, [users]);

  const handleSelect = (user: User | undefined) => {
    onSelect?.(user);
  };

  const selectedUser = selected && users.find(u => u.login === selected.login);

  const defaultItem = {
    text: placeholder ?? 'Select a user...',
    icon: avatarIcon,
    value: undefined,
  };

  const items = useMemo(() => {
    const mappedUsers = users.map(u => ({
      text: u.login,
      value: u,
      icon: avatars[u.id],
    }));
    if (allowNone) {
      return [
        {
          text: unselectedLabel ?? 'None',
          icon: avatarIcon,
          value: undefined,
        },
        ...mappedUsers,
      ];
    }
    return mappedUsers;
  }, [users, allowNone, avatars, unselectedLabel]);

  return (
    <Combobox
      enabledOffline={enabledOffline}
      disabled={disabled}
      onChange={c => handleSelect(c)}
      items={items}
      defaultItem={defaultItem}
      selectedValue={selectedUser ?? undefined}
      className="user-picker"
    />
  );
}

function preloadAvatar(user: User) {
  if (!user.avatar) return Promise.resolve<[string, string]>([user.id, avatarIcon]);
  return new Promise<[string, string]>((res, rej) => {
    fetch(avatarURLWithSize(user.avatar))
      .then(response => response.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => {
          res([user.id, reader.result as string]);
        };
        reader.readAsDataURL(blob);
      })
      .catch(err => {
        rej('Error fetching the image: ' + err);
      });
  });
}
