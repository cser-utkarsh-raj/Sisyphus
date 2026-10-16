import React from 'react';
import { AuroraLogo } from './AuroraLogo.tsx';

interface SisyphusLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
}

export const SisyphusLogo: React.FC<SisyphusLogoProps> = (props) => {
  return <AuroraLogo {...props} />;
};
