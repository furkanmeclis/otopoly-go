/**
 * Channel brand marks (ports of the web `components/icons/{whatsapp,netgsm,twilio,sms,email}-icon.tsx`) drawn
 * with react-native-svg. Brand colours are fixed (they are logos, not theme colours).
 */
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type IconProps = { size?: number; color?: string };

export const BRAND_COLORS = { whatsapp: '#25D366', netgsm: '#0057B8', twilio: '#F22F46', sms: '#7C3AED', email: '#0284C7' } as const;

export function WhatsAppIcon({ size = 24, color = BRAND_COLORS.whatsapp }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      <Path
        fill={color}
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"
      />
    </Svg>
  );
}

/** Netgsm: rounded square with an "n" and a signal arc. */
export function NetgsmIcon({ size = 24, color = BRAND_COLORS.netgsm }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      <Rect width={24} height={24} rx={5.5} fill={color} />
      <Path d="M6.5 17.5V10.2c0-.9.7-1.6 1.6-1.6h3.3c2.2 0 3.6 1.4 3.6 3.6v5.3" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M15.6 5.2a4.6 4.6 0 0 1 3.2 3.2" fill="none" stroke="#FF8A00" strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** Twilio: a ring with four dots. */
export function TwilioIcon({ size = 24, color = BRAND_COLORS.twilio }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      <Path fill={color} d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0Zm0 20.8a8.8 8.8 0 1 1 0-17.6 8.8 8.8 0 0 1 0 17.6Z" />
      <Circle cx={8.9} cy={8.9} r={2.3} fill={color} />
      <Circle cx={15.1} cy={8.9} r={2.3} fill={color} />
      <Circle cx={8.9} cy={15.1} r={2.3} fill={color} />
      <Circle cx={15.1} cy={15.1} r={2.3} fill={color} />
    </Svg>
  );
}

/** Generic SMS: a speech bubble with three dots. */
export function SmsIcon({ size = 24, color = BRAND_COLORS.sms }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M4 3h16a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-7.6L7 21.6c-.6.4-1.4 0-1.4-.7V18H4a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z" fill={color} />
      <Circle cx={7.5} cy={10.5} r={1.4} fill="#fff" />
      <Circle cx={12} cy={10.5} r={1.4} fill="#fff" />
      <Circle cx={16.5} cy={10.5} r={1.4} fill="#fff" />
    </Svg>
  );
}

/** E-mail: an envelope. */
export function EmailIcon({ size = 24, color = BRAND_COLORS.email }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      <Rect x={1.5} y={4} width={21} height={16} rx={3} fill={color} />
      <Path d="m4.5 7.5 7.5 5.5 7.5-5.5" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
