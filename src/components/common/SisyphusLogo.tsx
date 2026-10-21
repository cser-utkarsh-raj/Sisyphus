import React from 'react';
import { AuroraLogo } from './AuroraLogo.tsx';

interface AuroraLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
}

export const AuroraLogoBrand: React.FC<AuroraLogoProps> = (props) => {
  return <AuroraLogo {...props} />;
};

export default AuroraLogoBrand;
