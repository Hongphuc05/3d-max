// useFadeInUpOnce.js
import { useSpring } from '@react-spring/web';
import { useInView } from 'react-intersection-observer';

export const useFadeInUpOnce = (delay = 0) => {
  const [ref, inView] = useInView({
    triggerOnce: true,
    threshold: 0.2,
  });

  const spring = useSpring({
    from: { opacity: 0, transform: 'translateY(40px)' },
    to: {
      opacity: inView ? 1 : 0,
      transform: inView ? 'translateY(0px)' : 'translateY(40px)',
    },
    delay,
    config: { tension: 180, friction: 24 },
  });

  return [ref, spring];
};
